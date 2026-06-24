import { Injectable } from '@nestjs/common';
import  moment from 'moment';

const getEnv: any = () => process.env.NODE_ENV ?? 'local';
const getCookieConfig = () => {
  return {
    secure: getEnv() !== ConstantsService.NODE_ENV.LOCAL,
    httpOnly: true,
    expires: moment().add(1, 'h').toDate(),
  };
};

@Injectable()
export class ConstantsService {
  static readonly NODE_ENV = {
    LOCAL: 'local',
    DEV: 'dev',
    UAT: 'uat',
    PROD: 'prod',
  };

  static readonly CORS = {
    ALLOWED_HEADERS: 'authorization,content-type',
    EXPOSED_HEADERS: 'token',
    METHODS: 'GET,POST,OPTIONS,PUT,DELETE',
  };
}
