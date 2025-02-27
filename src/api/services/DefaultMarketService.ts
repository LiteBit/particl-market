// Copyright (c) 2017-2019, The Particl Market developers
// Distributed under the GPL software license, see the accompanying
// file COPYING or https://github.com/particl/particl-market/blob/develop/LICENSE

import * as _ from 'lodash';
import * as resources from 'resources';
import { inject, named } from 'inversify';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets } from '../../constants';
import { Market } from '../models/Market';
import { MarketService } from './model/MarketService';
import { MarketCreateRequest } from '../requests/model/MarketCreateRequest';
import { MarketUpdateRequest } from '../requests/model/MarketUpdateRequest';
import { CoreRpcService } from './CoreRpcService';
import { SmsgService } from './SmsgService';
import { InternalServerException } from '../exceptions/InternalServerException';
import { MarketType } from '../enums/MarketType';
import { ProfileService } from './model/ProfileService';
import { SettingService } from './model/SettingService';
import { SettingValue } from '../enums/SettingValue';
import { WalletService } from './model/WalletService';
import {MessageException} from '../exceptions/MessageException';
import {WalletCreateRequest} from '../requests/model/WalletCreateRequest';

export class DefaultMarketService {

    public log: LoggerType;

    constructor(
        @inject(Types.Service) @named(Targets.Service.model.ProfileService) public profileService: ProfileService,
        @inject(Types.Service) @named(Targets.Service.model.MarketService) public marketService: MarketService,
        @inject(Types.Service) @named(Targets.Service.model.SettingService) public settingService: SettingService,
        @inject(Types.Service) @named(Targets.Service.model.WalletService) public walletService: WalletService,
        @inject(Types.Service) @named(Targets.Service.CoreRpcService) public coreRpcService: CoreRpcService,
        @inject(Types.Service) @named(Targets.Service.SmsgService) public smsgService: SmsgService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
    }

    // TODO: if something goes wrong here and default profile does not get created, the application should stop

    public async seedDefaultMarket(profile: resources.Profile): Promise<Market> {

        const profileSettings: resources.Setting[] = await this.settingService.findAllByProfileId(profile.id).then(value => value.toJSON());

        const marketNameSetting = _.find(profileSettings, value => {
            return value.key === SettingValue.DEFAULT_MARKETPLACE_NAME;
        });

        const marketPKSetting = _.find(profileSettings, value => {
            return value.key === SettingValue.DEFAULT_MARKETPLACE_PRIVATE_KEY;
        });

        const marketAddressSetting = _.find(profileSettings, value => {
            return value.key === SettingValue.DEFAULT_MARKETPLACE_ADDRESS;
        });

        if (marketNameSetting === undefined || marketPKSetting === undefined || marketAddressSetting === undefined) {
            throw new MessageException('Default Market settings not found!');
        }

        // the initial default marketplace should use a wallet called market.dat
        const defaultMarketWallet: resources.Wallet = await this.walletService.findOneByName('market.dat')
            .then(value => value.toJSON())
            .catch(async reason => {
                return await this.walletService.create({
                    profile_id: profile.id,
                    name: 'market.dat'
                } as WalletCreateRequest).then(value => value.toJSON());
            });

        const defaultMarket = {
            wallet_id: defaultMarketWallet.id,
            profile_id: profile.id,
            name: marketNameSetting.value,
            type: MarketType.MARKETPLACE,
            receiveKey: marketPKSetting.value,
            receiveAddress: marketAddressSetting.value,
            publishKey: marketPKSetting.value,
            publishAddress: marketAddressSetting.value
        } as MarketCreateRequest;

        const market = await this.insertOrUpdateMarket(defaultMarket, profile);
        this.log.debug('seedDefaultMarket(), market: ', JSON.stringify(market.toJSON(), null, 2));
        return market;
    }

    public async insertOrUpdateMarket(marketRequest: MarketCreateRequest, profile: resources.Profile): Promise<Market> {

        // create or update the default marketplace
        const newMarket: resources.Market = await this.marketService.findOneByProfileIdAndReceiveAddress(profile.id, marketRequest.receiveAddress)
            .then(async (found) => {
                this.log.debug('found market, update... ');
                return await this.marketService.update(found.Id, marketRequest as MarketUpdateRequest).then(value => value.toJSON());
            })
            .catch(async (reason) => {
                this.log.debug('did NOT find market, create... ');
                return await this.marketService.create(marketRequest).then(value => value.toJSON());
            });

        // if wallet with the name doesnt exists, then create one
        const exists = await this.coreRpcService.walletExists(newMarket.Wallet.name);
        this.log.debug('wallet exists: ', exists);

        if (!exists) {
            await this.coreRpcService.createAndLoadWallet(newMarket.Wallet.name)
                .then(result => {
                    this.log.debug('created wallet: ', result.name);
                })
                .catch(reason => {
                    this.log.debug('wallet: ' + marketRequest.name + ' already exists.');
                });
        } else {
            // load the wallet unless already loaded
            await this.coreRpcService.walletLoaded(newMarket.Wallet.name).
                then(async isLoaded => {
                    if (!isLoaded) {
                        await this.coreRpcService.loadWallet(newMarket.Wallet.name)
                            .catch(reason => {
                                this.log.debug('wallet: ' + marketRequest.name + ' already loaded.');
                            });
                    }
                });
        }
        await this.coreRpcService.setActiveWallet(newMarket.Wallet.name);

        await this.importMarketPrivateKey(newMarket.receiveKey, newMarket.receiveAddress);
        if (newMarket.publishKey && newMarket.publishAddress && (newMarket.receiveKey !== newMarket.publishKey)) {
            await this.importMarketPrivateKey(newMarket.publishKey, newMarket.publishAddress);
        }

        // set secure messaging to use the default wallet
        await this.coreRpcService.smsgSetWallet(newMarket.Wallet.name);

        return await this.marketService.findOne(newMarket.id);
    }

    public async importMarketPrivateKey(privateKey: string, address: string): Promise<void> {
        if ( await this.smsgService.smsgImportPrivKey(privateKey) ) {
            // get market public key
            const publicKey = await this.getPublicKeyForAddress(address);
            this.log.debug('default Market publicKey: ', publicKey);
            // add market address
            if (publicKey) {
                await this.smsgService.smsgAddAddress(address, publicKey);
            } else {
                throw new InternalServerException('Error while adding public key to db.');
            }
        } else {
            this.log.error('Error while importing market private key to db.');
            // todo: throw exception, and do not allow market to run before its properly set up
        }
    }

    private async getPublicKeyForAddress(address: string): Promise<string|null> {
        return await this.smsgService.smsgLocalKeys()
            .then(localKeys => {
                for (const smsgKey of localKeys.smsg_keys) {
                    if (smsgKey.address === address) {
                        return smsgKey.public_key;
                    }
                }
                return null;
            })
            .catch(error => null);
    }
}
