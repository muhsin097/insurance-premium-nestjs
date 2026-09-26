import { IsBoolean, IsInt, Max, Min } from 'class-validator';

export class CreateQuoteDto {
  @IsInt()
  @Min(0)
  @Max(120)
  age!: number;

  @IsBoolean()
  hasPreExistingConditions!: boolean;
}
