import type { Input } from '@ethereumjs/rlp';
import type { EIP2718CompatibleTx } from '../types.ts';
export declare function getHashedMessageToSign(tx: EIP2718CompatibleTx): Uint8Array;
export declare function serialize(tx: EIP2718CompatibleTx, base?: Input): Uint8Array;
export declare function validateYParity(tx: EIP2718CompatibleTx): void;
//# sourceMappingURL=eip2718.d.ts.map