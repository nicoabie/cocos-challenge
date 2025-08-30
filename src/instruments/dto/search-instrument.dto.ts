import { IsOptional, IsString } from 'class-validator';

export class SearchInstrumentDto {
  @IsOptional()
  @IsString()
  q?: string;
}
