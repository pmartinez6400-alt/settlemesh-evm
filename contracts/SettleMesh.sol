// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SettleMesh — policy-guarded agent-to-agent escrow settlement
/// @notice Two AI agents settle a paid service through this escrow. The buyer
///         agent's spending policy (per-payment cap, daily cap, payee
///         allowlist) is stored and enforced ON-CHAIN: a payment that violates
///         the policy cannot be created, even if the buyer agent is buggy,
///         compromised, or manipulated by a counterparty agent.
/// @dev Settlement flow:
///        1. Buyer sets a policy and an allowlist of payees.
///        2. Buyer deposits funds into escrow (`deposit`).
///        3. Buyer opens a job for an allowlisted payee (`createJob`) —
///           policy checks run here; violations revert.
///        4. Payee delivers the service off-chain and attests its content
///           hash on-chain (`attestDelivery`).
///        5. Buyer verifies the delivered content against the attested hash
///           and releases payment (`releasePayment`).
///        6. If delivery never arrives, the buyer can cancel before
///           attestation or claim a refund after the job deadline
///           (`cancelJob` / `refundJob`); the reserved budget is restored.
contract SettleMesh {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    enum JobStatus {
        None,
        Funded, // escrowed, awaiting delivery
        Delivered, // payee attested a delivery hash, awaiting release
        Released, // paid to payee (terminal)
        Cancelled, // buyer cancelled before delivery (terminal)
        Refunded // deadline passed without delivery, buyer refunded (terminal)
    }

    struct Policy {
        uint256 perPaymentCap; // max amount for a single job
        uint256 dailyCap; // max total job value created per day
        bool isSet;
    }

    struct Job {
        address buyer;
        address payee;
        uint256 amount;
        bytes32 serviceRef; // hash of the agreed service description / quote
        bytes32 deliveryHash; // hash of the delivered artifact, set by payee
        uint64 deadline; // refund unlock time if undelivered
        uint256 dayIndex; // day the job reserved budget from (for restore)
        JobStatus status;
    }

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------

    mapping(address => Policy) public policies;
    mapping(address => mapping(address => bool)) public payeeAllowed;
    /// @notice Free (unreserved) escrow balance per buyer.
    mapping(address => uint256) public balances;
    /// @notice Job value reserved per buyer per day: buyer => dayIndex => amount.
    mapping(address => mapping(uint256 => uint256)) public spentOnDay;

    Job[] private _jobs;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event PolicyUpdated(address indexed buyer, uint256 perPaymentCap, uint256 dailyCap);
    event PayeeAllowlistUpdated(address indexed buyer, address indexed payee, bool allowed);
    event Deposited(address indexed buyer, uint256 amount);
    event Withdrawn(address indexed buyer, uint256 amount);
    event JobCreated(
        uint256 indexed jobId,
        address indexed buyer,
        address indexed payee,
        uint256 amount,
        bytes32 serviceRef,
        uint64 deadline
    );
    event DeliveryAttested(uint256 indexed jobId, address indexed payee, bytes32 deliveryHash);
    event PaymentReleased(uint256 indexed jobId, address indexed payee, uint256 amount);
    event JobCancelled(uint256 indexed jobId);
    event JobRefunded(uint256 indexed jobId);

    // ------------------------------------------------------------------
    // Errors (policy violations are first-class, machine-readable)
    // ------------------------------------------------------------------

    error PolicyNotSet();
    error ZeroAmount();
    error ExceedsPerPaymentCap(uint256 amount, uint256 cap);
    error ExceedsDailyCap(uint256 amount, uint256 alreadySpent, uint256 cap);
    error PayeeNotAllowlisted(address payee);
    error InsufficientBalance(uint256 available, uint256 required);
    error InvalidJob(uint256 jobId);
    error NotBuyer(uint256 jobId, address caller);
    error NotPayee(uint256 jobId, address caller);
    error WrongStatus(uint256 jobId, JobStatus status);
    error JobNotExpired(uint256 jobId, uint64 deadline);
    error EmptyDeliveryHash();
    error TransferFailed();

    // ------------------------------------------------------------------
    // Policy administration (buyer)
    // ------------------------------------------------------------------

    /// @notice Set or replace the caller's spending policy. Applies to jobs
    ///         created afterwards; existing jobs are unaffected.
    function setPolicy(uint256 perPaymentCap, uint256 dailyCap) external {
        if (perPaymentCap == 0 || dailyCap == 0) revert ZeroAmount();
        policies[msg.sender] = Policy({
            perPaymentCap: perPaymentCap,
            dailyCap: dailyCap,
            isSet: true
        });
        emit PolicyUpdated(msg.sender, perPaymentCap, dailyCap);
    }

    /// @notice Allow or disallow a payee for the caller's future jobs.
    function setPayeeAllowed(address payee, bool allowed) external {
        payeeAllowed[msg.sender][payee] = allowed;
        emit PayeeAllowlistUpdated(msg.sender, payee, allowed);
    }

    // ------------------------------------------------------------------
    // Escrow funding (buyer)
    // ------------------------------------------------------------------

    /// @notice Deposit native token (HSK / tHSK) into escrow.
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        balances[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw free (unreserved) escrow balance.
    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[msg.sender];
        if (available < amount) revert InsufficientBalance(available, amount);
        balances[msg.sender] = available - amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Job lifecycle
    // ------------------------------------------------------------------

    /// @notice Open a job: reserve `amount` from the caller's escrow balance
    ///         for `payee`. ALL policy checks are enforced here, on-chain.
    /// @param payee Allowlisted seller agent address.
    /// @param amount Job price in wei.
    /// @param serviceRef Hash of the agreed service description / quote.
    /// @param ttlSeconds Seconds until an undelivered job becomes refundable.
    /// @return jobId The id of the created job.
    function createJob(
        address payee,
        uint256 amount,
        bytes32 serviceRef,
        uint64 ttlSeconds
    ) external returns (uint256 jobId) {
        Policy memory policy = policies[msg.sender];
        if (!policy.isSet) revert PolicyNotSet();
        if (amount == 0) revert ZeroAmount();

        // --- Policy enforcement (the heart of SettleMesh) ---
        if (amount > policy.perPaymentCap) {
            revert ExceedsPerPaymentCap(amount, policy.perPaymentCap);
        }
        if (!payeeAllowed[msg.sender][payee]) {
            revert PayeeNotAllowlisted(payee);
        }
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOnDay[msg.sender][day];
        if (spent + amount > policy.dailyCap) {
            revert ExceedsDailyCap(amount, spent, policy.dailyCap);
        }

        // --- Escrow accounting ---
        uint256 available = balances[msg.sender];
        if (available < amount) revert InsufficientBalance(available, amount);
        balances[msg.sender] = available - amount;
        spentOnDay[msg.sender][day] = spent + amount;

        uint64 deadline = uint64(block.timestamp) + ttlSeconds;
        _jobs.push(
            Job({
                buyer: msg.sender,
                payee: payee,
                amount: amount,
                serviceRef: serviceRef,
                deliveryHash: bytes32(0),
                deadline: deadline,
                dayIndex: day,
                status: JobStatus.Funded
            })
        );
        jobId = _jobs.length - 1;
        emit JobCreated(jobId, msg.sender, payee, amount, serviceRef, deadline);
    }

    /// @notice Payee attests delivery by committing the hash of the delivered
    ///         artifact. The buyer compares this hash with the artifact it
    ///         received off-chain before releasing payment.
    function attestDelivery(uint256 jobId, bytes32 deliveryHash) external {
        Job storage job = _jobOrRevert(jobId);
        if (job.payee != msg.sender) revert NotPayee(jobId, msg.sender);
        if (job.status != JobStatus.Funded) revert WrongStatus(jobId, job.status);
        if (deliveryHash == bytes32(0)) revert EmptyDeliveryHash();
        job.deliveryHash = deliveryHash;
        job.status = JobStatus.Delivered;
        emit DeliveryAttested(jobId, msg.sender, deliveryHash);
    }

    /// @notice Buyer releases the escrowed payment to the payee. Only
    ///         possible after delivery has been attested.
    function releasePayment(uint256 jobId) external {
        Job storage job = _jobOrRevert(jobId);
        if (job.buyer != msg.sender) revert NotBuyer(jobId, msg.sender);
        if (job.status != JobStatus.Delivered) revert WrongStatus(jobId, job.status);
        job.status = JobStatus.Released;
        (bool ok, ) = job.payee.call{value: job.amount}("");
        if (!ok) revert TransferFailed();
        emit PaymentReleased(jobId, job.payee, job.amount);
    }

    /// @notice Buyer cancels a job that has not been delivered yet. The
    ///         reserved amount and daily budget are restored.
    function cancelJob(uint256 jobId) external {
        Job storage job = _jobOrRevert(jobId);
        if (job.buyer != msg.sender) revert NotBuyer(jobId, msg.sender);
        if (job.status != JobStatus.Funded) revert WrongStatus(jobId, job.status);
        _restore(job, JobStatus.Cancelled);
        emit JobCancelled(jobId);
    }

    /// @notice Buyer reclaims escrow for a job whose deadline passed without
    ///         delivery. The reserved amount and daily budget are restored.
    function refundJob(uint256 jobId) external {
        Job storage job = _jobOrRevert(jobId);
        if (job.buyer != msg.sender) revert NotBuyer(jobId, msg.sender);
        if (job.status != JobStatus.Funded) revert WrongStatus(jobId, job.status);
        if (block.timestamp <= job.deadline) revert JobNotExpired(jobId, job.deadline);
        _restore(job, JobStatus.Refunded);
        emit JobRefunded(jobId);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function jobCount() external view returns (uint256) {
        return _jobs.length;
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobOrRevert(jobId);
    }

    function getPolicy(address buyer) external view returns (Policy memory) {
        return policies[buyer];
    }

    function balanceOf(address buyer) external view returns (uint256) {
        return balances[buyer];
    }

    /// @notice Job value the buyer has reserved so far today (UTC day).
    function spentToday(address buyer) external view returns (uint256) {
        return spentOnDay[buyer][block.timestamp / 1 days];
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _jobOrRevert(uint256 jobId) internal view returns (Job storage) {
        if (jobId >= _jobs.length) revert InvalidJob(jobId);
        return _jobs[jobId];
    }

    function _restore(Job storage job, JobStatus terminal) internal {
        job.status = terminal;
        balances[job.buyer] += job.amount;
        spentOnDay[job.buyer][job.dayIndex] -= job.amount;
    }
}
