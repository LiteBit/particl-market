import { inject, named } from 'inversify';
import * as _ from 'lodash';
import { validate } from '../../core/api/Validate';
import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets } from '../../constants';
import { MessageProcessorInterface } from './MessageProcessorInterface';
import { ListingItemFactory } from '../factories/ListingItemFactory';
import { ListingItemService } from '../services/ListingItemService';
import { ListingItem } from '../models/ListingItem';

import { ItemCategoryCreateRequest } from '../requests/ItemCategoryCreateRequest';

import { ListingItemCreateRequest } from '../requests/ListingItemCreateRequest';

import { ItemCategoryFactory } from '../factories/ItemCategoryFactory';
import { MessagingInformationFactory } from '../factories/MessagingInformationFactory';
import { ItemCategoryService } from '../services/ItemCategoryService';
import { isArray } from 'util';

export class ListingItemMessageProcessor implements MessageProcessorInterface {

    public log: LoggerType;
    constructor(
        @inject(Types.Factory) @named(Targets.Factory.ListingItemFactory) public listingItemFactory: ListingItemFactory,
        @inject(Types.Factory) @named(Targets.Factory.ItemCategoryFactory) public itemCategoryFactory: ItemCategoryFactory,
        @inject(Types.Factory) @named(Targets.Factory.MessagingInformationFactory) public mesInfoFactory: MessagingInformationFactory,
        @inject(Types.Service) @named(Targets.Service.ListingItemService) public listingItemService: ListingItemService,
        @inject(Types.Service) @named(Targets.Service.ItemCategoryService) public itemCategoryService: ItemCategoryService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
    }

    @validate()
    public async process(message: any): Promise<ListingItem> {
        // get Category
        const itemCategoryId = await this.createUserDefinedItemCategories(message.information.category);
        message.information.itemCategory = itemCategoryId;
        // get itemPrice
        const itemPrice = {
            currency: message.payment.cryptocurrency.currency,
            basePrice: message.payment.cryptocurrency.base_price
        };
        message.payment.itemPrice = itemPrice;
        // get messagingInformation
        const messagingInformation = await this.mesInfoFactory.get(message.messaging);
        message.messaging = messagingInformation;
        // Convert the ListingItemMessage to ListingItem
        const listingItem = await this.listingItemFactory.get(message);
        // create listing-item
        return await this.listingItemService.create(listingItem.toJSON() as ListingItemCreateRequest);
    }

    private async createUserDefinedItemCategories(category: string[]): Promise<number> {
        const rootCategoryWithRelated: any = await this.itemCategoryService.findRoot();
        const itemCategoryOutPut: any = await this.itemCategoryFactory.get(category, rootCategoryWithRelated);
        const itemCategory = itemCategoryOutPut.createdCategories;
        const lastCreatedIndex = itemCategoryOutPut.lastCheckIndex;
        let itemCategoryId: number;
        let parentItemCategoryId;
        if (lastCreatedIndex === category.length) {
            // all category is exist
            itemCategoryId = itemCategory[lastCreatedIndex].id;
        } else {
            // get and create category
            let newCat;
            parentItemCategoryId = itemCategory[lastCreatedIndex].id;
            for (let i = lastCreatedIndex + 1; i < category.length; i++) {
                newCat = await this.itemCategoryService.create({
                    name: category[i],
                    parent_item_category_id: parentItemCategoryId
                } as ItemCategoryCreateRequest);
                parentItemCategoryId = newCat.id;
            }
            itemCategoryId = newCat.id;
        }
        return itemCategoryId;
    }

}