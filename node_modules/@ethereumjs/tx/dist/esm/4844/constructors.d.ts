import { Blob4844Tx } from './tx.ts';
import type { JSONBlobTxNetworkWrapper, TxOptions } from '../types.ts';
import type { TxData, TxValuesArray } from './tx.ts';
/**
 * Instantiate a transaction from a data dictionary.
 *
 * Format: { chainId, nonce, gasPrice, gasLimit, to, value, data, accessList,
 * v, r, s, blobs, kzgCommitments, blobVersionedHashes, kzgProofs }
 *
 * Notes:
 * - `chainId` will be set automatically if not provided
 * - All parameters are optional and have some basic default values
 * - `blobs` cannot be supplied as well as `kzgCommitments`, `blobVersionedHashes`, `kzgProofs`
 * - If `blobs` is passed in,  `kzgCommitments`, `blobVersionedHashes`, `kzgProofs` will be derived by the constructor
 */
export declare function createBlob4844Tx(txData: TxData, opts?: TxOptions): Blob4844Tx;
/**
 * Create a transaction from an array of byte encoded values ordered according to the devp2p network encoding - format noted below.
 *
 * Format: `[chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data,
 * accessList, signatureYParity, signatureR, signatureS]`
 */
export declare function createBlob4844TxFromBytesArray(values: TxValuesArray, opts?: TxOptions): Blob4844Tx;
/**
 * Instantiate a transaction from a RLP serialized tx.
 *
 * Format: `0x03 || rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to, value, data,
 * access_list, max_fee_per_data_gas, blob_versioned_hashes, y_parity, r, s])`
 */
export declare function createBlob4844TxFromRLP(serialized: Uint8Array, opts?: TxOptions): Blob4844Tx;
/**
 * Creates a transaction from the network encoding of a blob transaction (with blobs/commitments/proof)
 * @param serialized a buffer representing a serialized BlobTransactionNetworkWrapper
 * @param opts any TxOptions defined
 * @returns a Blob4844Tx
 */
export declare function createBlob4844TxFromSerializedNetworkWrapper(serialized: Uint8Array, opts?: TxOptions): Blob4844Tx;
/**
 * Creates the minimal representation of a blob transaction from the network wrapper version.
 * The minimal representation is used when adding transactions to an execution payload/block
 * @param txData a {@link Blob4844Tx} containing optional blobs/kzg commitments
 * @param opts - dictionary of {@link TxOptions}
 * @returns the "minimal" representation of a Blob4844Tx (i.e. transaction object minus blobs and kzg commitments)
 */
export declare function createMinimal4844TxFromNetworkWrapper(txData: Blob4844Tx, opts?: TxOptions): Blob4844Tx;
/**
 * Returns the EIP 4844 transaction network wrapper in JSON format similar to toJSON, including
 * blobs, commitments, and proofs fields
 * @param serialized a buffer representing a serialized BlobTransactionNetworkWrapper
 * @param opts any TxOptions defined
 * @returns JSONBlobTxNetworkWrapper with blobs, KZG commitments, and KZG proofs fields
 */
export declare function blobTxNetworkWrapperToJSON(serialized: Uint8Array, opts?: TxOptions): JSONBlobTxNetworkWrapper;
//# sourceMappingURL=constructors.d.ts.map