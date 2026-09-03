type AgentOptions = { connect: { family: number } };

const mockSetGlobalDispatcher = jest.fn((): void => {});
const mockAgent = jest.fn<AgentOptions, [AgentOptions]>((opts) => opts);

jest.mock('undici', () => ({
  Agent: mockAgent,
  setGlobalDispatcher: mockSetGlobalDispatcher,
}));

import { configureIpv4OnlyDispatcher } from './network-dispatcher';

describe('configureIpv4OnlyDispatcher', () => {
  beforeEach(() => {
    mockSetGlobalDispatcher.mockClear();
    mockAgent.mockClear();
  });

  it('installs an IPv4-only dispatcher by default', () => {
    configureIpv4OnlyDispatcher({});

    expect(mockAgent).toHaveBeenCalledWith({ connect: { family: 4 } });
    expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(1);
  });

  it.each(['true', '1', 'yes', 'on', 'TRUE'])(
    'skips installing the dispatcher when DISABLE_FORCE_IPV4=%s',
    (value) => {
      configureIpv4OnlyDispatcher({ DISABLE_FORCE_IPV4: value });

      expect(mockSetGlobalDispatcher).not.toHaveBeenCalled();
    },
  );

  it('installs the dispatcher when DISABLE_FORCE_IPV4 is falsy or unset', () => {
    configureIpv4OnlyDispatcher({ DISABLE_FORCE_IPV4: 'false' });

    expect(mockSetGlobalDispatcher).toHaveBeenCalledTimes(1);
  });
});
