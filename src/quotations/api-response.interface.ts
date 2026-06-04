export interface IServiceResponse<T = any> {
  success: boolean;

  message: string;

  data?: T;
}