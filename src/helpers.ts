import * as StellarSdk from 'stellar-sdk';
import { AssetAmount } from './index';

/**
 * @internal
 * @param builder
 * @param source
 * @param destination
 * @param balance
 * @param sequenceNumber
 */
export function createAccount(
    builder: StellarSdk.TransactionBuilder,
    source: string,
    destination: string,
    balance: number,
    sequenceNumber?: string
): void {

    builder.addOperation(StellarSdk.Operation.createAccount({
        source: source,
        destination: destination,
        startingBalance: balance.toString()
    }));

    if (sequenceNumber) {
        builder.addOperation(StellarSdk.Operation.bumpSequence({
            source: destination,
            bumpTo: sequenceNumber
        }));
    }
}

/**
 *
 * @internal
 * @param builder
 * @param source
 * @param amount
 */
export function addTrustline(
    builder: StellarSdk.TransactionBuilder,
    source: string,
    amount: AssetAmount,
): void {
    //  add a trustline if underlying asset is not-native
    if (!amount.asset.isNative()) {
        builder.addOperation(StellarSdk.Operation.changeTrust({
            source: source,
            asset: amount.asset,
            limit: amount.amount.toString()
        }));
    }
}

/**
 *
 * @internal
 * @param builder
 * @param source
 * @param amount
 */
export function removeTrustline(
    builder: StellarSdk.TransactionBuilder,
    source: string,
    amount: AssetAmount,
): void {

    //  remove the trustline if underlying asset is not-native
    if (!amount.asset.isNative()) {
        builder.addOperation(StellarSdk.Operation.changeTrust({
            source: source,
            asset: amount.asset,
            limit: '0'
        }));
    }
}

/**
 *
 * @internal
 * @param builder
 * @param from
 * @param to
 * @param amount
 */
export function sendPayment(
    builder: StellarSdk.TransactionBuilder,
    from: string,
    to: string,
    amount: AssetAmount
): void {
    builder.addOperation(StellarSdk.Operation.payment({
        source: from,
        destination: to,
        asset: amount.asset,
        amount: amount.amount.toString()
    }));
}

/**
 *
 * @internal
 * @param builder
 * @param source
 * @param buyerTx
 * @param sellerTx
 */
export function lockEscrow(
    builder: StellarSdk.TransactionBuilder,
    source: string,
    buyerTx: StellarSdk.Transaction,
    sellerTx: StellarSdk.Transaction
): void {

    //  lock down the escrow account
    builder.addOperation(StellarSdk.Operation.setOptions({
        source: source,
        signer: {
            preAuthTx: buyerTx.hash(),
            weight: '1'
        }
    }))
    .addOperation(StellarSdk.Operation.setOptions({
        source: source,
        signer: {
            preAuthTx: sellerTx.hash(),
            weight: '1'
        }
    }))
    .addOperation(StellarSdk.Operation.setOptions({
        source: source,
        masterWeight: 0
    }));
}

/**
 *
 * @internal
 * @param builder
 * @param from
 * @param to
 */
export function mergeAccount(
    builder: StellarSdk.TransactionBuilder,
    from: string,
    to: string
): void {
    builder.addOperation(StellarSdk.Operation.accountMerge({
        source: from,
        destination: to
    }));
}
