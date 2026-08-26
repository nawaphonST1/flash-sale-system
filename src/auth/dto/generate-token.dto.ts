import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class GenerateTokenDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsOptional()
  username?: string;

  @IsString()
  @IsOptional()
  role?: string;
}
