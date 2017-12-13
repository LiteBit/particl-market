import { Logger as LoggerType } from '../../core/Logger';
import { Types, Core, Targets } from '../../constants';
import { AddressService } from '../services/AddressService';
import { RpcRequest } from '../requests/RpcRequest';
import { Address } from '../models/Address';
import {RpcCommand} from './RpcCommand';

export class AddressCreateCommand implements RpcCommand<Address> {
    public log: LoggerType;
    public name: string;

    constructor(
        @inject(Types.Service) @named(Targets.Service.AddressService) private addressService: AddressService,
        @inject(Types.Core) @named(Core.Logger) public Logger: typeof LoggerType
    ) {
        this.log = new Logger(__filename);
        this.name = 'address.create';
    }

    public async execute( @request(RpcRequest) data: any): Promise<Address> {
        this.log.error('Attempting to create address');
        return await this.addressService.create({
            title : data.params[0],
            addressLine1 : data.params[1],
            addressLine2 : data.params[2],
            city : data.params[3],
            country : data.params[4],
            profile_id : data.params[5]
        });
    }

    public help(): string {
        return 'CreateAddressCommand: TODO: Fill in help string.';
    }
}