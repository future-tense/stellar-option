
import * as StellarSdk from 'stellar-sdk';
import BigNumber from 'bignumber.js';

import {
    addTrustline,
    createAccount,
    lockEscrow,
    mergeAccount,
    removeTrustline,
    sendPayment
} from './helpers'

/**
 * @public
 */

export type NetworkOptions = {
    network: string;
    baseReserve: number;
    fee: number;
    timeout: number;
}

/**
 * @public
 */

export type AssetAmount = {
    asset: StellarSdk.Asset,
    amount: number
}

/**
 * `underlying` is the asset that the buyer buys a right to buy an amount of.
 *
 * `premium` is the price the buyer pays the seller for that right.
 *
 * `exercise` is the price the buyer pays if the option is exercised.
 *
 * `expiry` is the timestamp at which the option matures and can be exercised.
 *
 * `delay` is how long (in seconds) after `expiry` the seller has to wait in order to
 * reclaim the underlying assets of an option not exercised.
 *
 * @public
 */

export type OptionParams = {
    underlying: AssetAmount,
    premium: AssetAmount,
    exercise: AssetAmount,
    expiry: number,
    delay: number
}

/**
 * This is used by [[createTransactions]] to return the transactions created

 `setup` contains a transaction that can be used to create an option.
 It creates the escrow account, puts the underlying assets in escrow,
 pays the seller the option premium, and locks itself down.

 Needs to be signed by both buyer and seller.

 `exercise` contains a transaction that the buyer can use to exercise
 the options right, by paying the seller the strike price to get the
 underlying assets out of escrow.

 Needs to be signed by the buyer.

 `refund` contains a transaction that the seller can use to reclaim the
 underlying asset from the escrow account.

 No additional signatures needed, can be submitted as-is.

 * @public
 */

export type OptionTransactions = {
    setup: StellarSdk.Transaction;
    exercise: StellarSdk.Transaction;
    refund: StellarSdk.Transaction;
}

/**
 * @internal
 */

const networkDefaults: NetworkOptions = {
    network: StellarSdk.Networks.PUBLIC,
    baseReserve: 0.5,
    fee: 1000,
    timeout: 1800
};

/**
 * @public
 */

export class Option {

    /**
     * @internal
     */
    private readonly buyer: string;
    /**
     * @internal
     */
    private readonly seller: string;

    /**
     * @internal
     */
    private readonly underlying: AssetAmount;
    /**
     * @internal
     */
    private readonly exercise: AssetAmount;
    /**
     * @internal
     */
    private readonly premium: AssetAmount;
    /**
     * @internal
     */
    private readonly expiry: number;
    /**
     * @internal
     */
    private readonly delay: number;

    /**
     * @internal
     */
    private readonly networkOptions: NetworkOptions;

    public constructor(
        buyer: string,
        seller: string,
        params: OptionParams,
        networkOptions?: Partial<NetworkOptions>
    ) {
        this.buyer = buyer;
        this.seller = seller;

        this.underlying = params.underlying;
        this.exercise = params.exercise;
        this.premium = params.premium;
        this.expiry = params.expiry;
        this.delay = params.delay;

        this.networkOptions = {
            ...networkDefaults,
            ...networkOptions
        };
    }

    public async createTransactions(
        server: StellarSdk.Server
    ): Promise<OptionTransactions> {
        const escrowKeys = StellarSdk.Keypair.random();
        const escrow = escrowKeys.publicKey();

        const account = await server.loadAccount(this.seller);
        const builder = new StellarSdk.TransactionBuilder(account, {
            networkPassphrase: this.networkOptions.network,
            fee: this.networkOptions.fee,
        });

        const escrowSequence = await this.calculateEscrowSequenceNumber(server);
        const balance = this.calculateStartingBalance();
        console.log(balance);

        createAccount(builder, this.seller, escrow, balance, escrowSequence);
        addTrustline(builder, escrow, this.underlying);
        sendPayment(builder, this.seller, escrow, this.underlying);
        sendPayment(builder, this.buyer, this.seller, this.premium);

        const sellerTx = this.buildRefundTransaction(escrow, escrowSequence);
        const buyerTx = this.buildExerciseTransaction(escrow, escrowSequence);
        lockEscrow(builder, escrow, buyerTx, sellerTx);

        const setupTx = builder
        .setTimeout(this.networkOptions.timeout)
        .build();

        setupTx.sign(escrowKeys);

        return {
            setup: setupTx,
            exercise: buyerTx,
            refund: sellerTx
        }
    }

    /**
     * @internal
     */
    private calculateStartingBalance(): number {
        const isNonNative: unknown = !this.underlying.asset.isNative();
        const numSubentries = 4 + (isNonNative as number);
        const numOperations = 3 + (isNonNative as number);
        return this.networkOptions.baseReserve * numSubentries +
            0.0000001 * this.networkOptions.fee * numOperations;
    }

    /**
     * @internal
     */
    private async calculateEscrowSequenceNumber(
        server: StellarSdk.Server
    ): Promise<string> {

        //  now:                                (timestamp = x, ledger = a)
        //  expiry of setup transaction:        (timestamp = y, ledger = b)
        //  option maturity:                    (timestamp = z, ledger = c)

        //  b, c are unknown, but are approximately:
        //  b ~= a + (y - x) / 5
        //  c ~= a + (z - x) / 5

        //  initial account seqnum will be in the range of `a` to `b`.
        //  on merge seqnum will have to be lower than `c`
        //  so, bump to something between `b` and `c`

        //  b ~= sequence + network.timeout / 5
        //  c ~= sequence + (expiry - now) / 5

        const ledger = await server.ledgers().order('desc').limit(1).call();
        const now = Date.parse(ledger.records[0].closed_at) / 1000;
        const sequence = ledger.records[0].sequence;

        const submitOffset = this.networkOptions.timeout;
        const expiryOffset = this.expiry - now;
        const midPointLedgerOffset = Math.floor((submitOffset + expiryOffset)/10);

        return ledgerToSequenceNumber(sequence + midPointLedgerOffset);
    }

    /**
     * @internal
     */
    private buildExerciseTransaction(
        escrow: string,
        sequenceNumber: string
    ): StellarSdk.Transaction {

        const account = new StellarSdk.Account(escrow, sequenceNumber);
        const builder = new StellarSdk.TransactionBuilder(account, {
            networkPassphrase: this.networkOptions.network,
            fee: this.networkOptions.fee,
            timebounds: {
                minTime: this.expiry,
                maxTime: this.expiry + this.delay
            }
        });

        sendPayment(builder, this.buyer, this.seller, this.exercise);
        sendPayment(builder, escrow, this.buyer, this.underlying);
        removeTrustline(builder, escrow, this.underlying);
        mergeAccount(builder, escrow, this.seller);

        return builder
        .build();
    }

    /**
     * @internal
     */
    private buildRefundTransaction(
        escrow: string,
        sequenceNumber: string
    ): StellarSdk.Transaction {

        const account = new StellarSdk.Account(escrow, sequenceNumber);
        const builder = new StellarSdk.TransactionBuilder(account, {
            networkPassphrase: this.networkOptions.network,
            fee: this.networkOptions.fee,
            timebounds: {
                minTime: this.expiry + this.delay,
                maxTime: 0
            }
        });

        sendPayment(builder, escrow, this.seller, this.underlying);
        removeTrustline(builder, escrow, this.underlying);
        mergeAccount(builder, escrow, this.seller);

        return builder
        .setTimeout(0)
        .build();
    }
}

/**
 * Converts a ledger index to its corresponding sequence number
 *
 * @internal
 * @param ledger - the index of the ledger
 * @returns a string encoding the sequence number
 */

function ledgerToSequenceNumber(ledger: number): string {
    return new BigNumber(ledger)
    .multipliedBy(4294967296)
    .toString();
}
