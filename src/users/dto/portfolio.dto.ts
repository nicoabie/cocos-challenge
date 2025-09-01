export class PositionDto {
  ticker: string;
  name: string;
  quantity: number;
  totalValue: number;
  performance: number;
}

export class PortfolioDto {
  totalValue: number;
  availableCash: number;
  positions: PositionDto[];
}
