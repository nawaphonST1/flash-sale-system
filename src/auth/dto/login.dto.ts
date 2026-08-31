import { IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

export class LoginDto {
  @ValidateIf((o) => !o.userId)
  @IsString({ message: 'username must be a string' })
  @IsNotEmpty({ message: 'username or userId is required' })
  username?: string;

  @ValidateIf((o) => !o.username)
  @IsString({ message: 'userId must be a string' })
  @IsNotEmpty({ message: 'username or userId is required' })
  userId?: string;

  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password is required' })
  password?: string;

  @IsString({ message: 'role must be a string' })
  @IsOptional()
  role?: string;
}

