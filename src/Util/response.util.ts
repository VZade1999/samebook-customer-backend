export const successRes = (res, message, data, statusCode?) => {
  return res.status(statusCode || 200).send({
    success: true,
    message: message || 'API Response completed',
    data: data || null,
  });
};

export const failedRes = (res, message, statusCode?) => {
  return res.status(statusCode || 500).send({
    success: false,
    message: message,
  });
};

export const errorRes = (res, error, statusCode?) => {
  return res.status(statusCode || 500).send({
    success: false,
    message: 'Something went wrong',
    error: error,
  });
};
