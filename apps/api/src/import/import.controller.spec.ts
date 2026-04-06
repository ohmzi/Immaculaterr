import { BadRequestException } from '@nestjs/common';
import { ImportController } from './import.controller';

function makeController() {
  const importService = {
    parseAndStoreNetflixCsv: jest.fn(),
    hasUnprocessedEntries: jest.fn(),
    getEntryCounts: jest.fn(),
    getImportStatus: jest.fn(),
  };
  const settingsService = {
    getInternalSettings: jest.fn(),
  };
  const jobsService = {
    runJob: jest.fn(),
    queueJob: jest.fn(),
  };

  const controller = new ImportController(
    importService as never,
    settingsService as never,
    jobsService as never,
  );

  return {
    controller,
    importService,
    settingsService,
    jobsService,
  };
}

describe('ImportController.uploadNetflixCsv', () => {
  it('rejects tampered uploaded files that are not arrays', async () => {
    const { controller, importService } = makeController();
    const req = { user: { id: 'user-1' } };
    const error = await controller
      .uploadNetflixCsv(req as never, 'not-an-array' as never)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe('CSV file is required');
    expect(importService.parseAndStoreNetflixCsv).not.toHaveBeenCalled();
  });

  it('rejects multiple uploaded files', async () => {
    const { controller, importService } = makeController();
    const req = { user: { id: 'user-1' } };
    const files = [
      { originalname: 'one.csv', buffer: Buffer.from('') },
      { originalname: 'two.csv', buffer: Buffer.from('') },
    ];
    const error = await controller
      .uploadNetflixCsv(req as never, files as never)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe(
      'Only one file can be uploaded at a time',
    );
    expect(importService.parseAndStoreNetflixCsv).not.toHaveBeenCalled();
  });
});
