import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class MedicalDeclarationDto {
  @IsBoolean()
  smoker!: boolean;

  @IsBoolean()
  recentHospitalization!: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chronicConditions?: string[];
}
