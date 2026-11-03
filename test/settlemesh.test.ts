import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SettleMesh } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const H = (v: string) => ethers.parseEther(v); // helper: ether-denominated amounts
const HASH_A = ethers.keccak256(ethers.toUtf8Bytes("service: token-risk-report HSK"));
const HASH_B = ethers.keccak256(ethers.toUtf8Bytes("delivery: report-json-v1"));

describe("SettleMesh", function () {
  let mesh: SettleMesh;
  let buyer: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let rogue: HardhatEthersSigner;

  const PER_PAYMENT_CAP = H("0.05");
  const DAILY_CAP = H("0.12");

  beforeEach(async function () {
    [buyer, seller, rogue] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("SettleMesh");
    mesh = (await factory.deploy()) as unknown as SettleMesh;
    await mesh.waitForDeployment();

    await mesh.connect(buyer).setPolicy(PER_PAYMENT_CAP, DAILY_CAP);
    await mesh.connect(buyer).setPayeeAllowed(seller.address, true);
    await mesh.connect(buyer).deposit({ value: H("0.20") });
  });

  async function createJob(amount: bigint, payee = seller.address, ttl = 3600) {
    const tx = await mesh.connect(buyer).createJob(payee, amount, HASH_A, ttl);
    const receipt = await tx.wait();
    const log = receipt!.logs.find(
      (l) => (l as any).fragment?.name === "JobCreated"
    ) as any;
    return Number(mesh.interface.parseLog(log)!.args.jobId);
  }

  describe("policy administration & funding", function () {
    it("stores the buyer policy", async function () {
      const p = await mesh.getPolicy(buyer.address);
      expect(p.perPaymentCap).to.equal(PER_PAYMENT_CAP);
      expect(p.dailyCap).to.equal(DAILY_CAP);
      expect(p.isSet).to.equal(true);
    });

    it("tracks deposits and withdrawals of free balance", async function () {
      expect(await mesh.balanceOf(buyer.address)).to.equal(H("0.20"));
      await mesh.connect(buyer).withdraw(H("0.05"));
      expect(await mesh.balanceOf(buyer.address)).to.equal(H("0.15"));
    });

    it("rejects withdrawing more than the free balance", async function () {
      await expect(mesh.connect(buyer).withdraw(H("0.21"))).to.be.revertedWithCustomError(
        mesh,
        "InsufficientBalance"
      );
    });

    it("rejects jobs when no policy is set", async function () {
      await expect(
        mesh.connect(rogue).createJob(seller.address, H("0.01"), HASH_A, 3600)
      ).to.be.revertedWithCustomError(mesh, "PolicyNotSet");
    });
  });

  describe("on-chain policy enforcement (the core guarantee)", function () {
    it("REFUSES a payment above the per-payment cap", async function () {
      await expect(
        mesh.connect(buyer).createJob(seller.address, H("0.09"), HASH_A, 3600)
      )
        .to.be.revertedWithCustomError(mesh, "ExceedsPerPaymentCap")
        .withArgs(H("0.09"), PER_PAYMENT_CAP);
    });

    it("REFUSES a payment to a non-allowlisted payee", async function () {
      await expect(
        mesh.connect(buyer).createJob(rogue.address, H("0.03"), HASH_A, 3600)
      )
        .to.be.revertedWithCustomError(mesh, "PayeeNotAllowlisted")
        .withArgs(rogue.address);
    });

    it("REFUSES jobs that would breach the daily cap in aggregate", async function () {
      await createJob(H("0.05"));
      await createJob(H("0.05"));
      // 0.10 of the 0.12 daily cap is reserved; another 0.05 must be refused
      // even though it is within the per-payment cap.
      await expect(
        mesh.connect(buyer).createJob(seller.address, H("0.05"), HASH_A, 3600)
      ).to.be.revertedWithCustomError(mesh, "ExceedsDailyCap");
      // A smaller job that fits the remaining budget is fine.
      await createJob(H("0.02"));
      expect(await mesh.spentToday(buyer.address)).to.equal(H("0.12"));
    });

    it("REFUSES a job larger than the free escrow balance", async function () {
      // Policy allows up to 0.05, but drain most of the balance first.
      await mesh.connect(buyer).withdraw(H("0.18"));
      await expect(
        mesh.connect(buyer).createJob(seller.address, H("0.05"), HASH_A, 3600)
      ).to.be.revertedWithCustomError(mesh, "InsufficientBalance");
    });

    it("policy changes apply to subsequent jobs", async function () {
      await mesh.connect(buyer).setPolicy(H("0.01"), H("0.02"));
      await expect(
        mesh.connect(buyer).createJob(seller.address, H("0.03"), HASH_A, 3600)
      ).to.be.revertedWithCustomError(mesh, "ExceedsPerPaymentCap");
    });
  });

  describe("happy-path settlement", function () {
    it("escrows, attests delivery, and releases payment to the seller", async function () {
      const jobId = await createJob(H("0.03"));

      let job = await mesh.getJob(jobId);
      expect(job.status).to.equal(1n); // Funded
      expect(await mesh.balanceOf(buyer.address)).to.equal(H("0.17"));

      await expect(mesh.connect(seller).attestDelivery(jobId, HASH_B))
        .to.emit(mesh, "DeliveryAttested")
        .withArgs(jobId, seller.address, HASH_B);

      // Measure across the release only (the seller pays gas to attest).
      const sellerBefore = await ethers.provider.getBalance(seller.address);
      await expect(mesh.connect(buyer).releasePayment(jobId))
        .to.emit(mesh, "PaymentReleased")
        .withArgs(jobId, seller.address, H("0.03"));

      job = await mesh.getJob(jobId);
      expect(job.status).to.equal(3n); // Released
      expect(job.deliveryHash).to.equal(HASH_B);
      const sellerAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerAfter - sellerBefore).to.equal(H("0.03"));
    });

    it("prevents release before delivery is attested", async function () {
      const jobId = await createJob(H("0.03"));
      await expect(mesh.connect(buyer).releasePayment(jobId)).to.be.revertedWithCustomError(
        mesh,
        "WrongStatus"
      );
    });

    it("prevents a second release", async function () {
      const jobId = await createJob(H("0.03"));
      await mesh.connect(seller).attestDelivery(jobId, HASH_B);
      await mesh.connect(buyer).releasePayment(jobId);
      await expect(mesh.connect(buyer).releasePayment(jobId)).to.be.revertedWithCustomError(
        mesh,
        "WrongStatus"
      );
    });

    it("only the payee can attest delivery", async function () {
      const jobId = await createJob(H("0.03"));
      await expect(
        mesh.connect(rogue).attestDelivery(jobId, HASH_B)
      ).to.be.revertedWithCustomError(mesh, "NotPayee");
    });

    it("only the buyer can release payment", async function () {
      const jobId = await createJob(H("0.03"));
      await mesh.connect(seller).attestDelivery(jobId, HASH_B);
      await expect(
        mesh.connect(seller).releasePayment(jobId)
      ).to.be.revertedWithCustomError(mesh, "NotBuyer");
    });
  });

  describe("cancellation & refund", function () {
    it("buyer can cancel an undelivered job and recover budget", async function () {
      const jobId = await createJob(H("0.05"));
      await mesh.connect(buyer).cancelJob(jobId);
      expect(await mesh.balanceOf(buyer.address)).to.equal(H("0.20"));
      expect(await mesh.spentToday(buyer.address)).to.equal(0n);
      const job = await mesh.getJob(jobId);
      expect(job.status).to.equal(4n); // Cancelled
    });

    it("cannot cancel after delivery is attested", async function () {
      const jobId = await createJob(H("0.03"));
      await mesh.connect(seller).attestDelivery(jobId, HASH_B);
      await expect(mesh.connect(buyer).cancelJob(jobId)).to.be.revertedWithCustomError(
        mesh,
        "WrongStatus"
      );
    });

    it("refunds an expired, undelivered job and restores daily budget", async function () {
      const jobId = await createJob(H("0.05"), seller.address, 120);
      await time.increase(121);
      await expect(mesh.connect(buyer).refundJob(jobId)).to.emit(mesh, "JobRefunded");
      expect(await mesh.balanceOf(buyer.address)).to.equal(H("0.20"));
      expect(await mesh.spentToday(buyer.address)).to.equal(0n);
    });

    it("refuses refund before the deadline", async function () {
      const jobId = await createJob(H("0.05"), seller.address, 3600);
      await expect(mesh.connect(buyer).refundJob(jobId)).to.be.revertedWithCustomError(
        mesh,
        "JobNotExpired"
      );
    });

    it("daily budget resets on a new day", async function () {
      await createJob(H("0.05"));
      await createJob(H("0.05"));
      await time.increase(86401); // next UTC day
      expect(await mesh.spentToday(buyer.address)).to.equal(0n);
      await createJob(H("0.05")); // fits again under the daily cap
    });
  });
});
