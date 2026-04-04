import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CollectionsService } from './collections.service';
import {
  CreateCollectionDto,
  AddCollectionItemDto,
  ImportCollectionJsonDto,
} from './dto/collections.dto';

@Controller('collections')
@ApiTags('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  async list() {
    return { collections: await this.collections.listCollections() };
  }

  @Post()
  async create(@Body() body: CreateCollectionDto) {
    const name = typeof body?.name === 'string' ? body.name : '';
    return {
      ok: true,
      collection: await this.collections.createCollection(name),
    };
  }

  @Post('seed-defaults')
  async seedDefaults() {
    return { ok: true, collections: await this.collections.seedDefaults() };
  }

  @Delete(':collectionId')
  async delete(@Param('collectionId') collectionId: string) {
    await this.collections.deleteCollection(collectionId);
    return { ok: true };
  }

  @Get(':collectionId/items')
  async listItems(@Param('collectionId') collectionId: string) {
    return { items: await this.collections.listItems(collectionId) };
  }

  @Post(':collectionId/items')
  async addItem(
    @CurrentUser() user: AuthUser,
    @Param('collectionId') collectionId: string,
    @Body() body: AddCollectionItemDto,
  ) {
    const userId = user.id;
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const ratingKey =
      typeof body?.ratingKey === 'string' ? body.ratingKey : undefined;
    const item = await this.collections.addItem({
      userId,
      collectionId,
      title,
      ratingKey,
    });
    return { ok: true, item };
  }

  @Delete(':collectionId/items/:itemId')
  async deleteItem(
    @Param('collectionId') collectionId: string,
    @Param('itemId') itemIdRaw: string,
  ) {
    const itemId = Number.parseInt(itemIdRaw, 10);
    await this.collections.deleteItem({ collectionId, itemId });
    return { ok: true };
  }

  @Post(':collectionId/import-json')
  async importJson(
    @CurrentUser() user: AuthUser,
    @Param('collectionId') collectionId: string,
    @Body() body: ImportCollectionJsonDto,
  ) {
    const userId = user.id;
    const json = typeof body?.json === 'string' ? body.json : '';
    const result = await this.collections.importFromJson({
      userId,
      collectionId,
      json,
    });
    return { ok: true, result };
  }

  @Get(':collectionId/export-json')
  async exportJson(@Param('collectionId') collectionId: string) {
    return {
      ok: true,
      items: await this.collections.exportToJson(collectionId),
    };
  }
}
