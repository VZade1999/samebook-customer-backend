import { Response } from 'express';

export const successRes = (
  res: Response,
  message?: string,
  data?: any,
  statusCode?: number,
) => {
  return res.status(statusCode || 200).send({
    success: true,
    message: message || 'API Response completed',
    data: data || null,
  });
};

export const failedRes = (
  res: Response,
  message?: string,
  statusCode?: number,
) => {
  return res.status(statusCode || 500).send({
    success: false,
    message: message,
  });
};

export const errorRes = (
  res: Response,
  error?: any,
  statusCode?: number,
) => {
  return res.status(statusCode || 500).send({
    success: false,
    message: 'Something went wrong',
    error: error,
  });
};