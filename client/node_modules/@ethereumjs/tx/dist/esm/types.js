import { bytesToBigInt, toBytes } from '@ethereumjs/util';
/**
 * Can be used in conjunction with {@link Transaction[TransactionType].supports}
 * to query on tx capabilities
 */
export const Capability = {
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
export function isAccessListBytes(input) {
    if (input.length === 0) {
        return true;
    }
    const firstItem = input[0];
    if (Array.isArray(firstItem)) {
        return true;
    }
    return false;
}
export function isAccessList(input) {
    return !isAccessListBytes(input); // This is exactly the same method, except the output is negated.
}
export const TransactionType = {
    Legacy: 0,
    AccessListEIP2930: 1,
    FeeMarketEIP1559: 2,
    BlobEIP4844: 3,
    EOACodeEIP7702: 4,
};
export function isLegacyTx(tx) {
    return tx.type === TransactionType.Legacy;
}
export function isAccessList2930Tx(tx) {
    return tx.type === TransactionType.AccessListEIP2930;
}
export function isFeeMarket1559Tx(tx) {
    return tx.type === TransactionType.FeeMarketEIP1559;
}
export function isBlob4844Tx(tx) {
    return tx.type === TransactionType.BlobEIP4844;
}
export function isEOACode7702Tx(tx) {
    return tx.type === TransactionType.EOACodeEIP7702;
}
export function isLegacyTxData(txData) {
    const txType = Number(bytesToBigInt(toBytes(txData.type)));
    return txType === TransactionType.Legacy;
}
export function isAccessList2930TxData(txData) {
    const txType = Number(bytesToBigInt(toBytes(txData.type)));
    return txType === TransactionType.AccessListEIP2930;
}
export function isFeeMarket1559TxData(txData) {
    const txType = Number(bytesToBigInt(toBytes(txData.type)));
    return txType === TransactionType.FeeMarketEIP1559;
}
export function isBlob4844TxData(txData) {
    const txType = Number(bytesToBigInt(toBytes(txData.type)));
    return txType === TransactionType.BlobEIP4844;
}
export function isEOACode7702TxData(txData) {
    const txType = Number(bytesToBigInt(toBytes(txData.type)));
    return txType === TransactionType.EOACodeEIP7702;
}
//# sourceMappingURL=types.js.map