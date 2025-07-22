"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBlob4844Tx = createBlob4844Tx;
exports.createBlob4844TxFromBytesArray = createBlob4844TxFromBytesArray;
exports.createBlob4844TxFromRLP = createBlob4844TxFromRLP;
exports.createBlob4844TxFromSerializedNetworkWrapper = createBlob4844TxFromSerializedNetworkWrapper;
exports.createMinimal4844TxFromNetworkWrapper = createMinimal4844TxFromNetworkWrapper;
exports.blobTxNetworkWrapperToJSON = blobTxNetworkWrapperToJSON;
const rlp_1 = require("@ethereumjs/rlp");
const util_1 = require("@ethereumjs/util");
const params_ts_1 = require("../params.js");
const types_ts_1 = require("../types.js");
const access_ts_1 = require("../util/access.js");
const tx_ts_1 = require("./tx.js");
const internal_ts_1 = require("../util/internal.js");
const validateBlobTransactionNetworkWrapper = (blobVersionedHashes, blobs, commitments, kzgProofs, version, kzg) => {
    if (!(blobVersionedHashes.length === blobs.length && blobs.length === commitments.length)) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Number of blobVersionedHashes, blobs, and commitments not all equal');
    }
    if (blobVersionedHashes.length === 0) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid transaction with empty blobs');
    }
    let isValid;
    try {
        isValid = kzg.verifyBlobProofBatch(blobs, commitments, kzgProofs);
    }
    catch (error) {
        throw (0, util_1.EthereumJSErrorWithoutCode)(`KZG verification of blobs fail with error=${error}`);
    }
    if (!isValid) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('KZG proof cannot be verified from blobs/commitments');
    }
    for (let x = 0; x < blobVersionedHashes.length; x++) {
        const computedVersionedHash = (0, util_1.computeVersionedHash)(commitments[x], version);
        if (computedVersionedHash !== blobVersionedHashes[x]) {
            throw (0, util_1.EthereumJSErrorWithoutCode)(`commitment for blob at index ${x} does not match versionedHash`);
        }
    }
};
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
function createBlob4844Tx(txData, opts) {
    if (opts?.common?.customCrypto?.kzg === undefined) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx');
    }
    const kzg = opts.common.customCrypto.kzg;
    if (txData.blobsData !== undefined) {
        if (txData.blobs !== undefined) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('cannot have both raw blobs data and encoded blobs in constructor');
        }
        if (txData.kzgCommitments !== undefined) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('cannot have both raw blobs data and KZG commitments in constructor');
        }
        if (txData.blobVersionedHashes !== undefined) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('cannot have both raw blobs data and versioned hashes in constructor');
        }
        if (txData.kzgProofs !== undefined) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('cannot have both raw blobs data and KZG proofs in constructor');
        }
        txData.blobs = (0, util_1.getBlobs)(txData.blobsData.reduce((acc, cur) => acc + cur));
        txData.kzgCommitments = (0, util_1.blobsToCommitments)(kzg, txData.blobs);
        txData.blobVersionedHashes = (0, util_1.commitmentsToVersionedHashes)(txData.kzgCommitments);
        txData.kzgProofs = (0, util_1.blobsToProofs)(kzg, txData.blobs, txData.kzgCommitments);
    }
    return new tx_ts_1.Blob4844Tx(txData, opts);
}
/**
 * Create a transaction from an array of byte encoded values ordered according to the devp2p network encoding - format noted below.
 *
 * Format: `[chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data,
 * accessList, signatureYParity, signatureR, signatureS]`
 */
function createBlob4844TxFromBytesArray(values, opts = {}) {
    if (opts.common?.customCrypto?.kzg === undefined) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx');
    }
    if (values.length !== 11 && values.length !== 14) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid EIP-4844 transaction. Only expecting 11 values (for unsigned tx) or 14 values (for signed tx).');
    }
    const [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, accessList, maxFeePerBlobGas, blobVersionedHashes, v, r, s,] = values;
    (0, internal_ts_1.validateNotArray)({ chainId, v });
    (0, util_1.validateNoLeadingZeroes)({
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit,
        value,
        maxFeePerBlobGas,
        v,
        r,
        s,
    });
    return new tx_ts_1.Blob4844Tx({
        chainId: (0, util_1.bytesToBigInt)(chainId),
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
        gasLimit,
        to,
        value,
        data,
        accessList: accessList ?? [],
        maxFeePerBlobGas,
        blobVersionedHashes,
        v: v !== undefined ? (0, util_1.bytesToBigInt)(v) : undefined, // EIP2930 supports v's with value 0 (empty Uint8Array)
        r,
        s,
    }, opts);
}
/**
 * Instantiate a transaction from a RLP serialized tx.
 *
 * Format: `0x03 || rlp([chain_id, nonce, max_priority_fee_per_gas, max_fee_per_gas, gas_limit, to, value, data,
 * access_list, max_fee_per_data_gas, blob_versioned_hashes, y_parity, r, s])`
 */
function createBlob4844TxFromRLP(serialized, opts = {}) {
    if (opts.common?.customCrypto?.kzg === undefined) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx');
    }
    if ((0, util_1.equalsBytes)(serialized.subarray(0, 1), (0, internal_ts_1.txTypeBytes)(types_ts_1.TransactionType.BlobEIP4844)) === false) {
        throw (0, util_1.EthereumJSErrorWithoutCode)(`Invalid serialized tx input: not an EIP-4844 transaction (wrong tx type, expected: ${types_ts_1.TransactionType.BlobEIP4844}, received: ${(0, util_1.bytesToHex)(serialized.subarray(0, 1))}`);
    }
    const values = rlp_1.RLP.decode(serialized.subarray(1));
    if (!Array.isArray(values)) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid serialized tx input: must be array');
    }
    return createBlob4844TxFromBytesArray(values, opts);
}
/**
 * Creates a transaction from the network encoding of a blob transaction (with blobs/commitments/proof)
 * @param serialized a buffer representing a serialized BlobTransactionNetworkWrapper
 * @param opts any TxOptions defined
 * @returns a Blob4844Tx
 */
function createBlob4844TxFromSerializedNetworkWrapper(serialized, opts) {
    if (!opts || !opts.common) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('common instance required to validate versioned hashes');
    }
    if (opts.common?.customCrypto?.kzg === undefined) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx');
    }
    if ((0, util_1.equalsBytes)(serialized.subarray(0, 1), (0, internal_ts_1.txTypeBytes)(types_ts_1.TransactionType.BlobEIP4844)) === false) {
        throw (0, util_1.EthereumJSErrorWithoutCode)(`Invalid serialized tx input: not an EIP-4844 transaction (wrong tx type, expected: ${types_ts_1.TransactionType.BlobEIP4844}, received: ${(0, util_1.bytesToHex)(serialized.subarray(0, 1))}`);
    }
    // Validate network wrapper
    const networkTxValues = rlp_1.RLP.decode(serialized.subarray(1));
    if (networkTxValues.length !== 4) {
        throw Error(`Expected 4 values in the deserialized network transaction`);
    }
    const [txValues, blobs, kzgCommitments, kzgProofs] = networkTxValues;
    // Construct the tx but don't freeze yet, we will assign blobs etc once validated
    const decodedTx = createBlob4844TxFromBytesArray(txValues, { ...opts, freeze: false });
    if (decodedTx.to === undefined) {
        throw Error('Blob4844Tx can not be send without a valid `to`');
    }
    const commonCopy = opts.common.copy();
    commonCopy.updateParams(opts.params ?? params_ts_1.paramsTx);
    const version = Number(commonCopy.param('blobCommitmentVersionKzg'));
    const blobsHex = blobs.map((blob) => (0, util_1.bytesToHex)(blob));
    const commsHex = kzgCommitments.map((com) => (0, util_1.bytesToHex)(com));
    const proofsHex = kzgProofs.map((proof) => (0, util_1.bytesToHex)(proof));
    validateBlobTransactionNetworkWrapper(decodedTx.blobVersionedHashes, blobsHex, commsHex, proofsHex, version, opts.common.customCrypto.kzg);
    // set the network blob data on the tx
    decodedTx.blobs = blobsHex;
    decodedTx.kzgCommitments = commsHex;
    decodedTx.kzgProofs = proofsHex;
    // freeze the tx
    const freeze = opts?.freeze ?? true;
    if (freeze) {
        Object.freeze(decodedTx);
    }
    return decodedTx;
}
/**
 * Creates the minimal representation of a blob transaction from the network wrapper version.
 * The minimal representation is used when adding transactions to an execution payload/block
 * @param txData a {@link Blob4844Tx} containing optional blobs/kzg commitments
 * @param opts - dictionary of {@link TxOptions}
 * @returns the "minimal" representation of a Blob4844Tx (i.e. transaction object minus blobs and kzg commitments)
 */
function createMinimal4844TxFromNetworkWrapper(txData, opts) {
    if (opts?.common?.customCrypto?.kzg === undefined) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('A common object with customCrypto.kzg initialized required to instantiate a 4844 blob tx');
    }
    const tx = createBlob4844Tx({
        ...txData,
        ...{ blobs: undefined, kzgCommitments: undefined, kzgProofs: undefined },
    }, opts);
    return tx;
}
/**
 * Returns the EIP 4844 transaction network wrapper in JSON format similar to toJSON, including
 * blobs, commitments, and proofs fields
 * @param serialized a buffer representing a serialized BlobTransactionNetworkWrapper
 * @param opts any TxOptions defined
 * @returns JSONBlobTxNetworkWrapper with blobs, KZG commitments, and KZG proofs fields
 */
function blobTxNetworkWrapperToJSON(serialized, opts) {
    const tx = createBlob4844TxFromSerializedNetworkWrapper(serialized, opts);
    const accessListJSON = (0, access_ts_1.accessListBytesToJSON)(tx.accessList);
    const baseJSON = tx.toJSON();
    return {
        ...baseJSON,
        chainId: (0, util_1.bigIntToHex)(tx.chainId),
        maxPriorityFeePerGas: (0, util_1.bigIntToHex)(tx.maxPriorityFeePerGas),
        maxFeePerGas: (0, util_1.bigIntToHex)(tx.maxFeePerGas),
        accessList: accessListJSON,
        maxFeePerBlobGas: (0, util_1.bigIntToHex)(tx.maxFeePerBlobGas),
        blobVersionedHashes: tx.blobVersionedHashes,
        blobs: tx.blobs,
        kzgCommitments: tx.kzgCommitments,
        kzgProofs: tx.kzgProofs,
    };
}
//# sourceMappingURL=constructors.js.map