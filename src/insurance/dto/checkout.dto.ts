import { IsString, IsUUID } from 'class-validator';

export class CheckoutDto {
  @IsUUID()
  quoteId!: string;

  @IsString()
  paymentToken!: string;
}
