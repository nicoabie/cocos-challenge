import {
  Controller,
  Get,
  Query,
  Param,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { InstrumentsService } from './instruments.service';
import { Instrument } from './instrument.entity';
import { SearchInstrumentDto } from './dto/search-instrument.dto';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get('search')
  search(@Query() searchDto: SearchInstrumentDto): Promise<Instrument[]> {
    return this.instrumentsService.search(searchDto.q ?? '');
  }

  @Get()
  findAll(): Promise<Instrument[]> {
    return this.instrumentsService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<Instrument> {
    const instrument = await this.instrumentsService.findById(id);
    if (!instrument) {
      throw new NotFoundException(`Instrument with ID ${id} not found`);
    }
    return instrument;
  }

  @Get('ticker/:ticker')
  async findByTicker(@Param('ticker') ticker: string): Promise<Instrument> {
    const instrument = await this.instrumentsService.findByTicker(ticker);
    if (!instrument) {
      throw new NotFoundException(`Instrument with ticker ${ticker} not found`);
    }
    return instrument;
  }
}
