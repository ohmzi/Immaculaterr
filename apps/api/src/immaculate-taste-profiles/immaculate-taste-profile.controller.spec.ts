import { ValidationPipe } from '@nestjs/common';
import { ImmaculateTasteProfileController } from './immaculate-taste-profile.controller';
import { UpdateProfileDto } from './dto/taste-profile.dto';

const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

async function transformUpdateBody(
  body: Record<string, unknown>,
): Promise<UpdateProfileDto> {
  return (await validationPipe.transform(body, {
    type: 'body',
    metatype: UpdateProfileDto,
  })) as UpdateProfileDto;
}

function makeController() {
  const profiles = {
    update: jest.fn().mockResolvedValue({ id: 'profile-1' }),
  };
  const controller = new ImmaculateTasteProfileController(profiles as never);
  return { controller, profiles };
}

const req = { user: { id: 'user-1' } };

function readUpdatePatch(update: jest.Mock): Record<string, unknown> {
  const calls = update.mock.calls as Array<
    [string, string, Record<string, unknown>]
  >;
  return calls[0][2];
}

describe('ImmaculateTasteProfileController update patch', () => {
  it('forwards only the client-provided fields for a scoped user update', async () => {
    const { controller, profiles } = makeController();

    const body = await transformUpdateBody({ scopePlexUserId: 'plex-user-2' });
    await controller.update(req as never, 'profile-1', body);

    const patch = readUpdatePatch(profiles.update);
    expect(Object.keys(patch).sort()).toEqual(['scopePlexUserId']);
    expect(patch.scopePlexUserId).toBe('plex-user-2');
  });

  it('keeps name and enabled for all-users updates', async () => {
    const { controller, profiles } = makeController();

    const body = await transformUpdateBody({
      name: 'Kids Picks',
      enabled: false,
    });
    await controller.update(req as never, 'profile-1', body);

    const patch = readUpdatePatch(profiles.update);
    expect(Object.keys(patch).sort()).toEqual(['enabled', 'name']);
    expect(patch).toMatchObject({ name: 'Kids Picks', enabled: false });
  });

  it('preserves an explicit null so nullable settings can be cleared', async () => {
    const { controller, profiles } = makeController();

    const body = await transformUpdateBody({ radarrInstanceId: null });
    await controller.update(req as never, 'profile-1', body);

    const patch = readUpdatePatch(profiles.update);
    expect(Object.keys(patch).sort()).toEqual(['radarrInstanceId']);
    expect(patch.radarrInstanceId).toBeNull();
  });
});
