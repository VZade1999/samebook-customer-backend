import { Injectable } from '@nestjs/common';
import { DAOService } from './dao.service';

@Injectable()
export class DAOFactory {
  create(model: any) {
    return new DAOService(model);
  }
}
