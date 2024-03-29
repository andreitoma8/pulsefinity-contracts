// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./MockERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockPulseX {
    address public factory_;
    address public WPLS_;

    mapping(address => mapping(address => address)) public pairs;

    constructor(address _WPLS) {
        WPLS_ = _WPLS;
    }

    function addLiquidityETH(address token, uint256 amountTokenDesired, uint256, uint256, address, uint256)
        external
        payable
        returns (uint256, uint256, uint256)
    {
        IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);
        _createPair(token, WPLS_);
        MockERC20 pair = MockERC20(pairs[token][WPLS_]);
        pair.mint(msg.sender, 1e18);
        return (amountTokenDesired, msg.value, 1e18);
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256,
        uint256,
        address to,
        uint256
    ) external returns (uint256, uint256, uint256) {
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);
        _createPair(tokenA, tokenB);
        MockERC20 pair = MockERC20(pairs[tokenA][tokenB]);
        pair.mint(to, 1e18);
        return (amountADesired, amountBDesired, 1e18);
    }

    function factory() external view returns (address) {
        return address(this);
    }

    function WPLS() external view returns (address) {
        return WPLS_;
    }

    function getPair(address _tokenA, address _tokenB) external view returns (address) {
        return pairs[_tokenA][_tokenB];
    }

    function _createPair(address tokenA, address tokenB) internal {
        address pair = address(new MockERC20("LP Token", "LP"));
        pairs[tokenA][tokenB] = pair;
        pairs[tokenB][tokenA] = pair;
    }
}
