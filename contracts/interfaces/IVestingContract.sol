// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVestingContract {
    enum DurationUnits {
        Days,
        Weeks,
        Months
    }

    struct VestingSchedule {
        // beneficiary of tokens after they are released
        address beneficiary;
        // start time of the vesting period
        uint256 start;
        // duration of the vesting period in DurationUnits
        uint256 duration;
        // units of the duration
        DurationUnits durationUnits;
        // total amount of tokens to be released at the end of the vesting;
        uint256 amountTotal;
        // amount of tokens released
        uint256 released;
    }

    /**
     * @notice Creates a vesting schedule
     * @param _token The token to be vested
     * @param _beneficiary The address of the beneficiary
     * @param _start The start UNIX timestamp of the vesting period
     * @param _duration The duration of the vesting period in DurationUnits
     * @param _durationUnits The units of the duration(0 = days, 1 = weeks, 2 = months)
     * @param _amountTotal The total amount of tokens to be vested
     * @dev Approve the contract to transfer the tokens before calling this function
     */
    function createVestingSchedule(
        address _token,
        address _beneficiary,
        uint256 _start,
        uint256 _duration,
        DurationUnits _durationUnits,
        uint256 _amountTotal
    ) external;

    /**
     * @notice Releases the vested tokens for a beneficiary
     * @param _token The token to be released
     * @param _beneficiary The address of the beneficiary
     */
    function release(address _token, address _beneficiary) external;

    /**
     * @notice Returns the releasable amount of tokens for a beneficiary
     * @param _token The token to query for
     * @param _beneficiary The address of the beneficiary
     */
    function getReleaseableAmount(address _token, address _beneficiary) external view returns (uint256);
}
