import { ethers } from "ethers";

const toWei = (amount: string) => ethers.utils.parseEther(amount);

const helperconfig = {
    // The address of the Pulsefinity token
    pulsefinityAddress: "0x41Ff71a99D7744cc5e62418d59774e19e30F7426",
    // The amount of tokens needed to be staked to reach each tier
    // Only change the values in quotes
    tierLimits: {
        nano: toWei("100"),
        micro: toWei("800"),
        mega: toWei("2000"),
        giga: toWei("6000"),
        tera: toWei("10000"),
        teraPlus: toWei("10001"),
    },
    // The address of the pulseX router contract
    pulseXRouterAddress: "0x98bf93ebf5c380C0e6Ae8e192A7e2AE08edAcc02",
    // The address of the pulseX factory contract
    pulseXFactoryAddress: "0x1715a3e4a142d8b698131108995174f37aeba10d",
};

export default helperconfig;
