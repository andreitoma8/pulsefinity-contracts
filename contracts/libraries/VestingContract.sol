// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IVestingContract.sol";

/**
 * @title VestingContract
 * @notice This is a simple vesting contract that allows to create vesting schedules for a beneficiary with monthly unlocks.
 */
contract VestingContract is IVestingContract {
    using SafeERC20 for IERC20;

    /**
     * @notice List of users to tokens to vesting schedules
     */
    mapping(address => mapping(address => VestingSchedule[])) public vestingSchedules;

    /**
     * @notice Emitted when a vesting schedule is created
     * @param beneficiary The address of the beneficiary
     * @param start The start UNIX timestamp of the vesting period
     * @param duration The duration of the vesting period in DurationUnits
     * @param durationUnits The units of the duration(0 = days, 1 = weeks, 2 = months)
     */
    event VestingScheduleCreated(
        address indexed beneficiary, uint256 start, uint256 duration, DurationUnits durationUnits, uint256 amountTotal
    );

    /**
     * @notice Emitted when tokens are released
     * @param beneficiary The address of the beneficiary
     * @param amount The amount of tokens released
     */
    event TokensReleased(address indexed beneficiary, uint256 amount);

    /**
     * @notice Creates a vesting schedule
     * @param _token The token to be vested
     * @param _beneficiary The address of the beneficiary
     * @param _start The start UNIX timestamp of the vesting period
     * (if the start time is in the past, the vesting period will start immediately)
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
    ) external {
        // perform input checks
        require(_beneficiary != address(0), "VestingContract: beneficiary is the zero address");
        require(_amountTotal > 0, "VestingContract: amount is 0");
        if (_start < block.timestamp) {
            _start = block.timestamp;
        }

        // transfer the tokens to be locked to the contract
        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amountTotal);

        // create the vesting schedule and add it to the list of schedules for the beneficiary
        vestingSchedules[_beneficiary][_token].push(
            VestingSchedule({
                beneficiary: _beneficiary,
                start: _start,
                duration: _duration,
                durationUnits: _durationUnits,
                amountTotal: _amountTotal,
                released: 0
            })
        );

        emit VestingScheduleCreated(_beneficiary, _start, _duration, _durationUnits, _amountTotal);
    }

    /**
     * @notice Releases the vested tokens for a beneficiary
     * @param _token The token to be released
     * @param _beneficiary The address of the beneficiary
     */
    function release(address _token, address _beneficiary) external {
        VestingSchedule[] storage schedules = vestingSchedules[_beneficiary][_token];
        uint256 schedulesLength = schedules.length;
        require(schedulesLength > 0, "VestingContract: no vesting schedules for beneficiary");

        uint256 totalRelease;

        for (uint256 i = 0; i < schedulesLength; i++) {
            VestingSchedule storage schedule = schedules[i];

            // calculate the releasable amount
            uint256 amountToSend = releasableAmount(schedule);
            if (amountToSend > 0) {
                // update the released amount
                schedule.released += amountToSend;
                // update the total released amount
                totalRelease += amountToSend;
                // transfer the tokens to the beneficiary
                IERC20(_token).safeTransfer(schedule.beneficiary, amountToSend);
            }
        }

        emit TokensReleased(_beneficiary, totalRelease);
    }

    /**
     * @notice Returns the releasable amount of tokens for a beneficiary
     * @param _token The token to query for
     * @param _beneficiary The address of the beneficiary
     */
    function getReleaseableAmount(address _token, address _beneficiary) external view returns (uint256) {
        VestingSchedule[] memory schedules = vestingSchedules[_beneficiary][_token];
        if (schedules.length == 0) return 0;

        uint256 amountToSend = 0;
        for (uint256 i = 0; i < schedules.length; i++) {
            VestingSchedule memory schedule = vestingSchedules[_beneficiary][_token][i];
            amountToSend += releasableAmount(schedule);
        }
        return amountToSend;
    }

    /**
     * @notice Returns the releasable amount of tokens for a vesting schedule
     * @param _schedule The vesting schedule
     */
    function releasableAmount(VestingSchedule memory _schedule) internal view returns (uint256) {
        return vestedAmount(_schedule) - _schedule.released;
    }

    /**
     * @notice Returns the vested amount of tokens for a vesting schedule
     * @param _schedule The vesting schedule
     */
    function vestedAmount(VestingSchedule memory _schedule) public view returns (uint256) {
        if (_schedule.duration == 0 && _schedule.start >= block.timestamp) {
            return _schedule.amountTotal;
        }
        uint256 sliceInSeconds;
        if (_schedule.durationUnits == DurationUnits.Days) {
            sliceInSeconds = 1 days;
        } else if (_schedule.durationUnits == DurationUnits.Weeks) {
            sliceInSeconds = 7 days;
        } else if (_schedule.durationUnits == DurationUnits.Months) {
            sliceInSeconds = 30 days;
        }
        if (block.timestamp < _schedule.start) {
            return 0;
        } else if (block.timestamp >= _schedule.start + _schedule.duration * sliceInSeconds) {
            return _schedule.amountTotal;
        } else {
            uint256 monthsPassed = (block.timestamp - _schedule.start) / sliceInSeconds;
            return (_schedule.amountTotal * monthsPassed) / _schedule.duration;
        }
    }
}
