import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PortfolioDto } from '../portfolio/dto/portfolio.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly portfolioService: PortfolioService,
  ) {}

  @Get()
  findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<User> {
    const user = await this.usersService.findOne(id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  @Get('email/:email')
  async findByEmail(@Param('email') email: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }
    return user;
  }

  @Get('account/:accountNumber')
  async findByAccountNumber(
    @Param('accountNumber') accountNumber: string,
  ): Promise<User> {
    const user = await this.usersService.findByAccountNumber(accountNumber);
    if (!user) {
      throw new NotFoundException(
        `User with account number ${accountNumber} not found`,
      );
    }
    return user;
  }

  @Get(':id/portfolio')
  async getPortfolio(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PortfolioDto> {
    const user = await this.usersService.findOne(id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return this.portfolioService.getPortfolio(id);
  }
}
