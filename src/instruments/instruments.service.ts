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

    // acá la verdad es que no son muchos activos y los campos de nombre y ticker
    // no son ni largos ni el tipo de busquedas van a ser muy complejas

    // no veo que tenga sentido agregar un indice para soportar full text search
    // https://www.postgresql.org/docs/current/textsearch-indexes.html

    // habría que ver métricas de cuantas búsquedas se hacen de activos, lo cierto es que hasta se podrían cachear dado que no cambian
    // mismo en el proceso de backend dado que no son muchos o en un redis si ya se tuviese alguno (si por alguna razón no se quisiera mantener estado en el proceso de backend)
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
