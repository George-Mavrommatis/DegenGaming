import { Common } from '@ethereumjs/common';
import type { TransactionInterface, TransactionType, TxData, TxOptions } from '../types.ts';
export declare function getCommon(common?: Common): Common;
export declare function txTypeBytes(txType: TransactionType): Uint8Array;
export declare function validateNotArray(values: {
    [key: string]: any;
}): void;
/**
 * Validates that an object with BigInt values cannot exceed the specified bit limit.
 * @param values Object containing string keys and BigInt values
 * @param bits Number of bits to check (64 or 256)
 * @param cannotEqual Pass true if the number also cannot equal one less the maximum value
 */
export declare function valueBoundaryCheck(values: {
    [key: string]: bigint | undefined;
}, bits?: number, cannotEqual?: boolean): void;
type Mutable<T> = {
    -readonly [P in keyof T]: T[P];
};
export declare function sharedConstructor(tx: Mutable<TransactionInterface>, txData: TxData[TransactionType], opts?: TxOptions): void;
export declare function getBaseJSON(tx: TransactionInterface): {
    type: `0x${string}`;
    nonce: `0x${string}`;
    gasLimit: `0x${string}`;
    to: `0x${string}` | undefined;
    value: `0x${string}`;
    data: `0x${string}`;
    v: `0x${string}` | undefined;
    r: `0x${string}` | undefined;
    s: `0x${string}` | undefined;
    chainId: `0x${string}`;
    yParity: `0x${string}` | undefined;
};
export {};
//# sourceMappingURL=internal.d.ts.map