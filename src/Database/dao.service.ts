import { Injectable, Scope } from '@nestjs/common';

interface SequalizeConditionObject {
  offset: number;
  limit: number;
  order?: [[string, string]];
  attributes?: string[];
}

/**
 * Class reperesnt the Generic Data Acceess Object
 */
export class DAOService {
  /**
   * @param {string} model - sequalize model
   */
  private model: any;
  constructor(model?: any) {
    this.model = model;
  }

  setModel(model: any) {
    this.model = model;
  }

  /**
   * Get list of records for specified model
   */
  getAllRecords = async (
    page: any,
    limit: any,
    sort: string,
    sortBy: string,
    condition: object,
    joins: object,
    fields?: string,
  ) => {
    try {
      page = page !== undefined ? page : 1;
      limit = limit !== undefined ? limit : 8;

      const start = (parseInt(page) - 1) * parseInt(limit);
      const end = parseInt(limit);

      let config: any = { offset: start, limit: end };
      let countConfig: any = {};

      if (sort) {
        sortBy = sortBy ? sortBy : 'ASC';
        config = {
          ...config,
          order: [[sortBy, sort]],
        };
      }

      if (fields && fields.length) {
        config = { ...config, attributes: fields.split(',') };
      }

      if (joins) {
        config = { ...config, ...joins };
        countConfig = { ...countConfig, ...joins };
      }

      if (condition) {
        config = { ...config, where: condition };
        countConfig = { ...countConfig, where: condition };
      }

      // if (searchCondition) {
      //     config = { ...config, ...searchCondition}
      // }

      console.log(`Config data ====> ${JSON.stringify(config)}`);

      const totalCount = await this.model.count(countConfig);

      const records = await this.model.findAll(config);
      // const totalCount = (page * limit)
      // const recordsCount = await this.model.count()

      const result = {
        page: parseInt(page),
        limit: parseInt(limit),
        records,
        totalCount,
      };

      if (records) {
        return { success: true, data: result };
      }
    } catch (e) {
      throw e;
    }
  };

  /**
   * Get a single record for specified model by unique idenntifier
   */
  getRecordById = async (id: number | string) => {
    try {
      if (id) {
        const record = await this.model.findOne({ where: { id: id } });
        if (record !== null) {
          return { success: true, data: record };
        }
      } else {
        return { success: false };
      }
      return { success: false };
    } catch (e) {
      throw e;
    }
  };

  /**
   * Get records for specified model by condition
   */
  getRecordsByCondition = async (condition: object, joins: any) => {
    try {
      if (condition) {
        const record = await this.model.findAll({ where: condition, ...joins });
        if (record !== null) {
          return { success: true, data: record };
        }
      } else {
        return { success: false };
      }
      return { success: false };
    } catch (e) {
      throw e;
    }
  };

  /**
   * Get a single record for specified model by condition
   */
  getRecordByCondition = async (
    condition: object,
    joins?: object | never,
    sort?: string,
    sortBy?: string,
  ) => {
    try {
      if (condition) {
        let config: any = { where: condition };

        if (joins) {
          config = { ...config, ...joins };
        }

        if (sort) {
          sortBy = sortBy ? sortBy : 'ASC';
          config = {
            ...config,
            order: [[sort, sortBy]],
          };
        }

        const record = await this.model.findOne(config);
        if (record !== null) {
          return { success: true, data: record };
        }
      } else {
        return { success: false };
      }
      return { success: false };
    } catch (e) {
      throw e;
    }
  };

  /**
   * Create a single record for specified model
   */
  createRecord = async (recordData: object) => {
    try {
      const record = await this.model.create(recordData);
      if (record !== null) {
        return { success: true, data: record };
      } else {
        return { success: false };
      }
    } catch (e) {
      throw e;
    }
  };

  /**
   * Create a single record for specified model
   */
  createRecords = async (recordsData: object) => {
    try {
      const records = await this.model.bulkCreate(recordsData);
      if (records !== null) {
        return { success: true, data: records };
      } else {
        return { success: false };
      }
    } catch (e) {
      throw e;
    }
  };

  /**
   * Update a single record for specified model by unique idenntifier
   */
  updateRecordById = async (id: number | string, updatedData: object) => {
    try {
      if (id && updatedData) {
        const record = await this.model.update(updatedData, {
          where: { id: id },
        });
        if (record !== null) {
          return { success: true, data: record };
        }
      } else {
        return { success: false };
      }
      return { success: false };
    } catch (e) {
      throw e;
    }
  };

  /**
   * Update a single record for specified model by unique idenntifier
   */
  updateRecordByCondition = async (updatedData: object, condition: object) => {
    try {
      if (updatedData && condition) {
        const record = await this.model.update(updatedData, {
          where: condition,
        });
        if (record !== null) {
          return { success: true, data: record };
        }
      } else {
        return { success: false };
      }
      return { success: false };
    } catch (e) {
      throw e;
    }
  };

  /**
   * Delete single record for specified model by unique idenntifier
   */
  deleteRecordById = async (id: number | string) => {
    try {
      if (id) {
        const record = await this.model.destroy({ where: { id: id } });
        if (record !== null) {
          return { success: true };
        }
      }
      return { success: false };
    } catch (e) {
      throw e;
    }
  };
}
