import { ethers } from "ethers";

const toWei = (amount: string) => ethers.utils.parseEther(amount);

const helperconfig = {
    // The address of the Pulsefinity token
    pulsefinityAddress: "0x6d1D0E083EF7C25BcBEdC900DEB0becD57C44E3e",
    // The amount of tokens needed to be staked to reach each tier
    // Only change the values in quotes
    tierLimits: {
        nano: toWei("10"),
        micro: toWei("20"),
        mega: toWei("30"),
        giga: toWei("40"),
        tera: toWei("50"),
        teraPlus: toWei("60"),
    },
    // The address of the pulseX router contract
    pulseXRouterAddress: "0x98bf93ebf5c380C0e6Ae8e192A7e2AE08edAcc02",
    // The address of the pulseX factory contract
    pulseXFactoryAddress: "0x1715a3e4a142d8b698131108995174f37aeba10d",
};

export default helperconfig;
