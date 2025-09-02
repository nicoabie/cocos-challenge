import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Instrument } from './instrument.entity';

@Injectable()
export class InstrumentsService {
  constructor(
    @InjectRepository(Instrument)
    private instrumentsRepository: Repository<Instrument>,
  ) {}

  async search(query: string): Promise<Instrument[]> {
    const searchQuery = query.trim();

    if (!searchQuery) {
      return this.instrumentsRepository.find();
    }

    return this.instrumentsRepository.find({
      where: [
        { ticker: ILike(`%${searchQuery}%`) },
        { name: ILike(`%${searchQuery}%`) },
      ],
      order: {
        ticker: 'ASC',
      },
    });
  }

  async findAll(): Promise<Instrument[]> {
    return this.instrumentsRepository.find({
      order: {
        ticker: 'ASC',
      },
    });
  }

  async findByTicker(ticker: string): Promise<Instrument | null> {
    return this.instrumentsRepository.findOne({
      where: { ticker: ticker.toUpperCase() },
    });
  }

  async findById(id: number): Promise<Instrument | null> {
    return this.instrumentsRepository.findOne({
      where: { id },
    });
  }
}
