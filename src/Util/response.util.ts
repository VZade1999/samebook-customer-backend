import { Response } from 'express';
import jwt from 'jsonwebtoken';

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



const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh-secret';

export const generateAccessToken = (payload: Record<string, any>) =>
  jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });

export const generateRefreshToken = (payload: Record<string, any>) =>
  jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });

export const verifyAccessToken = (token: string) => jwt.verify(token, ACCESS_SECRET);

export const verifyRefreshToken = (token: string) => jwt.verify(token, REFRESH_SECRET);
