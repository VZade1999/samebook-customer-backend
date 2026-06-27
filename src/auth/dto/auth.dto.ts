import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class AuthDto {
  @IsEmail()
  @IsNotEmpty()
  username!: string;

  @IsNotEmpty()
  @IsString()
  password!: string;
}