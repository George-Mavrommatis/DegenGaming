"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionType = exports.Capability = void 0;
exports.isAccessListBytes = isAccessListBytes;
exports.isAccessList = isAccessList;
exports.isLegacyTx = isLegacyTx;
exports.isAccessList2930Tx = isAccessList2930Tx;
exports.isFeeMarket1559Tx = isFeeMarket1559Tx;
exports.isBlob4844Tx = isBlob4844Tx;
exports.isEOACode7702Tx = isEOACode7702Tx;
exports.isLegacyTxData = isLegacyTxData;
exports.isAccessList2930TxData = isAccessList2930TxData;
exports.isFeeMarket1559TxData = isFeeMarket1559TxData;
exports.isBlob4844TxData = isBlob4844TxData;
exports.isEOACode7702TxData = isEOACode7702TxData;
const util_1 = require("@ethereumjs/util");
/**
 * Can be used in conjunction with {@link Transaction[TransactionType].supports}
 * to query on tx capabilities
 */
exports.Capability = {
    /**
     * Tx supports EIP-155 replay protection
     * See: [155](https://eips.ethereum.org/EIPS/eip-155) Replay Attack Protection EIP
     */
    EIP155ReplayProtection: 155,
    /**
     * Tx supports EIP-1559 gas fee market mechanism
     * See: [1559](https://eips.ethereum.org/EIPS/eip-1559) Fee Market EIP
     */
    EIP1559FeeMarket: 1559,
    /**
     * Tx is a typed transaction as defined in EIP-2718
     * See: [2718](https://eips.ethereum.org/EIPS/eip-2718) Transaction Type EIP
     */
    EIP2718TypedTransaction: 2718,
    /**
     * Tx supports access list generation as defined in EIP-2930
     * See: [2930](https://eips.ethereum.org/EIPS/eip-2930) Access Lists EIP
     */
    EIP2930AccessLists: 2930,
    /**
     * Tx supports setting EOA code
     * See [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
     */
    EIP7702EOACode: 7702,
};
function isAccessListBytes(input) {
    if (input.length === 0) {
        return true;
    }
    const firstItem = input[0];
    if (Array.isArray(firstItem)) {
        return true;
    }
    return false;
}
function isAccessList(input) {
    return !isAccessListBytes(input); // This is exactly the same method, except the output is negated.
}
exports.TransactionType = {
    Legacy: 0,
    AccessListEIP2930: 1,
    FeeMarketEIP1559: 2,
    BlobEIP4844: 3,
    EOACodeEIP7702: 4,
};
function isLegacyTx(tx) {
    return tx.type === exports.TransactionType.Legacy;
}
function isAccessList2930Tx(tx) {
    return tx.type === exports.TransactionType.AccessListEIP2930;
}
function isFeeMarket1559Tx(tx) {
    return tx.type === exports.TransactionType.FeeMarketEIP1559;
}
function isBlob4844Tx(tx) {
    return tx.type === exports.TransactionType.BlobEIP4844;
}
function isEOACode7702Tx(tx) {
    return tx.type === exports.TransactionType.EOACodeEIP7702;
}
function isLegacyTxData(txData) {
    const txType = Number((0, util_1.bytesToBigInt)((0, util_1.toBytes)(txData.type)));
    return txType === exports.TransactionType.Legacy;
}
function isAccessList2930TxData(txData) {
    const txType = Number((0, util_1.bytesToBigInt)((0, util_1.toBytes)(txData.type)));
    return txType === exports.TransactionType.AccessListEIP2930;
}
function isFeeMarket1559TxData(txData) {
    const txType = Number((0, util_1.bytesToBigInt)((0, util_1.toBytes)(txData.type)));
    return txType === exports.TransactionType.FeeMarketEIP1559;
}
function isBlob4844TxData(txData) {
    const txType = Number((0, util_1.bytesToBigInt)((0, util_1.toBytes)(txData.type)));
    return txType === exports.TransactionType.BlobEIP4844;
}
function isEOACode7702TxData(txData) {
    const txType = Number((0, util_1.bytesToBigInt)((0, util_1.toBytes)(txData.type)));
    return txType === exports.TransactionType.EOACodeEIP7702;
}
//# sourceMappingURL=types.js.map