# @futuretense/stellar-option

An options generator for Stellar

Generates Stellar smart contracts for European-style options.

An option is a financial instrument that gives a buyer the *right* (but not the obligation)
to buy an asset at a predetermined price, at a future date.

The option is implemented as a locked account where the underlying asset is held in escrow
until one of two things happen:

 * The buyer waits until the option matures, and decided to exercise the option.
 * The seller waits a bit longer, and is able to reclaim the underlying asset.

# Install

`npm install @futuretense/stellar-option`

# Usage

## Creating the option

``` typescript

import { Option } from '@futuretense/stellar-option';

//
//  paying 10 XLM for the option of buying 1 TEST for 200 XLM at expiry
//

const params = {
    underlying: {
        amount: 1,
        asset: new StellarSdk.Asset('TEST', issuer)
    },
    premium: {
        amount: 10,
        asset: StellarSdk.Asset.native()
    },
    exercise: {
        amount: 200,
        asset: StellarSdk.Asset.native()
    },
    expiry: Math.floor(Date.now()/1000) + 150,
    delay: 3600,
};

const option = new Option(
    buyer,
    seller,
    params
);

const server = new StellarSdk.Server('https://horizon.stellar.org');
const transactions = await option.createTransactions(server);

transactions.setup.sign(buyerKeys);
transactions.setup.sign(sellerKeys);

await server.submitTransaction(transactions.setup);

```

## Exercising the option

```
transactions.exercise.sign(buyerKeys);
await server.submitTransaction(transactions.exercise);
```

## Refunding to seller

```
await server.submitTransaction(transactions.refund);
```

Copyright &copy; 2020 Future Tense, LLC
