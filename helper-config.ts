import { ethers } from "ethers";

const toWei = (amount: string) => ethers.utils.parseEther(amount);

const helperconfig = {
    // The address of the Pulsefinity token
    pulsefinityAddress: "",
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
    pulseXRouterAddress: "",
    // The address of the pulseX factory contract
    pulseXFactoryAddress: "",
};

export default helperconfig;
