import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
import { UpdateProfileDto } from './dto/updateProfile.dto';

// Self-service only: every method here resolves to the caller's own user row
// (req.user.user_id, set by AuthGuard from the JWT) — there is no viewing or
// editing anyone else's profile from this module.
export interface ProfileRequester {
  userId: number;
  companyId: number;
}

const PROFILE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'date_of_birth',
  'gender',
  'marital_status',
  'blood_group',
  'permanent_address',
  'aadhar_no',
  'pan_no',
  'emergency_contact',
  'bank_name',
  'branch_name',
  'account_number',
  'account_type',
  'ifsc_code',
  'micr_code',
  'salary_payment_mode',
  'company_id',
  'created_at',
];

@Injectable()
export class ProfileService {
  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
  ) {}

  private get Users() {
    return this.dbProvider.db.users;
  }

  private parseBase64Avatar(avatar?: string): Buffer | undefined {
    if (!avatar) return undefined;
    const trimmed = avatar.trim();
    const matches = trimmed.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
    const base64Data = matches ? matches[2] : trimmed;
    if (!base64Data || !/^[A-Za-z0-9+/=]+$/.test(base64Data)) return undefined;
    try {
      return Buffer.from(base64Data, 'base64');
    } catch {
      return undefined;
    }
  }

  async getProfile(requester: ProfileRequester) {
    const log = this.appLogger.forContext('ProfileService', 'getProfile', {
      userId: requester.userId,
    });

    log.info('Fetching profile');

    let user: any;
    try {
      user = await this.Users.findOne({
        where: { id: requester.userId, company_id: requester.companyId, is_active: 1 },
        attributes: [...PROFILE_FIELDS, 'id', 'avatar'],
      });
    } catch (err) {
      log.error('DB error while fetching profile', err);
      throw new Error('DATABASE_ERROR');
    }

    if (!user) {
      log.warn('Profile not found');
      return { success: false, message: 'Profile not found' };
    }

    const json = user.toJSON();
    if (json.avatar && Buffer.isBuffer(json.avatar)) {
      json.avatar = `data:image/png;base64,${json.avatar.toString('base64')}`;
    }

    return { success: true, message: 'Profile fetched successfully', data: json };
  }

  async updateProfile(data: UpdateProfileDto, requester: ProfileRequester) {
    const log = this.appLogger.forContext('ProfileService', 'updateProfile', {
      userId: requester.userId,
    });

    log.info('Update profile attempt started');

    const user = await this.Users.findOne({
      where: { id: requester.userId, company_id: requester.companyId, is_active: 1 },
    });

    if (!user) {
      log.warn('Update failed — profile not found');
      return { success: false, message: 'Profile not found' };
    }

    let avatarUpdateValue: Buffer | null | undefined = undefined;
    if (data.avatar !== undefined) {
      if (data.avatar === null || data.avatar === '') {
        avatarUpdateValue = null;
      } else {
        const parsed = this.parseBase64Avatar(data.avatar);
        if (!parsed) {
          return { success: false, message: 'Invalid image data — use PNG, JPEG, or WEBP' };
        }
        avatarUpdateValue = parsed;
      }
    }

    try {
      await user.update({
        ...(data.first_name !== undefined && { first_name: data.first_name }),
        ...(data.last_name !== undefined && { last_name: data.last_name }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.date_of_birth !== undefined && { date_of_birth: data.date_of_birth }),
        ...(data.gender !== undefined && { gender: data.gender }),
        ...(data.marital_status !== undefined && { marital_status: data.marital_status }),
        ...(data.blood_group !== undefined && { blood_group: data.blood_group }),
        ...(data.permanent_address !== undefined && { permanent_address: data.permanent_address }),
        ...(data.aadhar_no !== undefined && { aadhar_no: data.aadhar_no }),
        ...(data.pan_no !== undefined && { pan_no: data.pan_no }),
        ...(data.emergency_contact !== undefined && { emergency_contact: data.emergency_contact }),
        ...(data.bank_name !== undefined && { bank_name: data.bank_name }),
        ...(data.branch_name !== undefined && { branch_name: data.branch_name }),
        ...(data.account_number !== undefined && { account_number: data.account_number }),
        ...(data.account_type !== undefined && { account_type: data.account_type }),
        ...(data.ifsc_code !== undefined && { ifsc_code: data.ifsc_code }),
        ...(data.micr_code !== undefined && { micr_code: data.micr_code }),
        ...(data.salary_payment_mode !== undefined && { salary_payment_mode: data.salary_payment_mode }),
        ...(data.avatar !== undefined && { avatar: avatarUpdateValue }),
      });
    } catch (err) {
      log.error('DB error while updating profile', err);
      throw new Error('DATABASE_ERROR');
    }

    log.info('Profile updated successfully');
    return this.getProfile(requester);
  }
}
