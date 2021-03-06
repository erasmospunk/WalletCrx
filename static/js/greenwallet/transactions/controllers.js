angular.module('greenWalletTransactionsControllers',
    ['greenWalletServices'])
.controller('TransactionsController', ['$scope', 'wallets', 'tx_sender', 'notices', 'branches', '$modal', 'gaEvent',
        function TransactionsController($scope, wallets, tx_sender, notices, branches, $modal, gaEvent) {
    if(!wallets.requireWallet($scope)) return;

    var limiter = {
        cur_limit: ['10'],
        redo: function() {
            if (this.cur_limit[0] == '10') this.last10();
            else if (this.cur_limit[0] == 'months') this.lastnmonths(this.cur_limit[1]);
            else if (this.cur_limit[0] == 'all') this.all();
        },
        last10: function() {
            $scope.wallet.transactions.limit = 10;
            $scope.wallet.transactions.populate_csv();
            this.cur_limit = ['10'];
        },
        lastnmonths: function(n) {
            $scope.wallet.transactions.limit = $scope.wallet.transactions.list.length;
            // find first tx older than n months and exclude it with all further txs
            for (var i = 0; i < $scope.wallet.transactions.limit; i++) {
                if ((new Date() - $scope.wallet.transactions.list[i].ts) > n*30*24*60*60*1000) {
                    $scope.wallet.transactions.limit = i;
                    break;
                }
            }
            $scope.wallet.transactions.populate_csv();
            this.cur_limit = ['months', n];
        },
        all: function() {
            $scope.wallet.transactions.limit = $scope.wallet.transactions.list.length;
            $scope.wallet.transactions.populate_csv();
            this.cur_limit = ['all'];
        }
    }
    $scope.$watch('wallet.transactions', function(newValue, oldValue) {
        if (!$scope.wallet.transactions) return;
        $scope.wallet.transactions.limiter = limiter;
        limiter.redo();
    });

    $scope.redeem = function(transaction) {
        gaEvent('Wallet', 'TransactionsTabRedeem');
        var key = tx_sender.hdwallet;
        key = key.subkey(branches.EXTERNAL, true, true);
        key = key.subkey(transaction.pubkey_pointer, true, true);
        tx_sender.call("http://greenaddressit.com/vault/prepare_sweep_social",
                key.public_key.getEncoded(true), false).then(function(data) {
            data.prev_outputs = [];
            for (var i = 0; i < data.prevout_scripts.length; i++) {
                data.prev_outputs.push(
                    {branch: branches.EXTERNAL, pointer: transaction.pubkey_pointer,
                     script: data.prevout_scripts[i]})
            }
            // TODO: verify
            wallets.sign_and_send_tx(undefined, data, true);  // priv_der=true
        }, function(error) {
            gaEvent('Wallet', 'TransactionsTabRedeemFailed', error.desc);
            notices.makeNotice('error', error.desc);
        });
    };

    $scope.generate_nlocktime = function(transaction, output) {
        wallets.get_two_factor_code($scope).then(function(twofactor_data) {
            tx_sender.call("http://greenaddressit.com/vault/prepare_nlocktime",
                [[transaction.txhash, output.pt_idx]], twofactor_data).then(function(data) {
                    // TODO: verify
                    console.log(data);
                    var tx = decode_raw_tx(Crypto.util.hexToBytes(data.tx));
                    var signatures = [];
                    var ins = [output];
                    for (var i = 0; i < ins.length; ++i) {
                        var out = ins[i];
                        var in_ = tx.ins[i];
                        var key = tx_sender.hdwallet;
                        key = key.subkey(branches.REGULAR, false, true);
                        key = key.subkey(out.pubkey_pointer, false, true);
                        key = new Bitcoin.ECKey(key.secret_exponent);
                        var script = new Bitcoin.Script(in_.script.chunks[3]);
                        var sign = key.sign(tx.hashTransactionForSignature(script, i, SIGHASH_ALL));
                        sign = Bitcoin.ECDSA.serializeSig(sign.r, sign.s);
                        sign.push(SIGHASH_ALL);

                        var in_script = new Bitcoin.Script();
                        in_script.writeOp(0);
                        in_script.writeBytes(in_.script.chunks[1]);  // ga sig
                        in_script.writeBytes(sign);  // user's sig
                        in_script.writeBytes(in_.script.chunks[3]);  // 2of2 outscript
                        in_.script = in_script;

                        data.tx = Crypto.util.bytesToHex(tx.serialize());
                    }
                    output.nlocktime_json = JSON.stringify(data);
            }, function(error) {
                notices.makeNotice('error', error.desc);
            });
        });
    };

    $scope.details = function(transaction) {
        gaEvent('Wallet', 'TransactionsTabDetailsModal');
        $scope.selected_transaction = transaction;
        $modal.open({
            templateUrl: '/'+LANG+'/wallet/partials/wallet_modal_tx_details.html',
            scope: $scope
        })
    };

}]);