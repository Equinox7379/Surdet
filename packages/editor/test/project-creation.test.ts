import { describe, expect, it, vi } from 'vitest';
import type { CreateProjectRequest, ProjectCreationLocation } from '../desktop/contracts.js';
import { createProjectCreation } from '../src/panels/project-creation.js';

const here: ProjectCreationLocation = { id: 'loc-1', location: 'D:\\作品' };
const there: ProjectCreationLocation = { id: 'loc-2', location: 'E:\\新作' };
const nativeError = (message: string) => new Error(`Error invoking remote method 'editor:create-project': Error: ${message}`);

function setup() {
  const bridge = {
    chooseProjectLocation: vi.fn<() => Promise<ProjectCreationLocation | null>>(),
    createProject: vi.fn<(request: CreateProjectRequest) => Promise<void>>(),
  };
  const changed = vi.fn();
  return { bridge, changed, creation: createProjectCreation(bridge, changed) };
}

describe('desktop new project form state', () => {
  it('offers creation only with a name and a location, and keeps the last location when a choice is cancelled', async () => {
    const { bridge, creation } = setup();
    expect(creation.canCreate()).toBe(false);
    creation.setName('  雾港 新作  ');
    expect(creation.canCreate()).toBe(false);
    bridge.chooseProjectLocation.mockResolvedValueOnce(here);
    await creation.chooseLocation();
    expect(creation.state.location).toEqual(here);
    expect(creation.canCreate()).toBe(true);
    bridge.chooseProjectLocation.mockResolvedValueOnce(null); // Cancelled, or another folder dialog is open.
    await creation.chooseLocation();
    expect(creation.state.location).toEqual(here);
    bridge.chooseProjectLocation.mockResolvedValueOnce(there); // A new choice replaces (and on the native side spends) the old id.
    await creation.chooseLocation();
    expect(creation.state.location).toEqual(there);
    creation.setName('   ');
    expect(creation.canCreate()).toBe(false);
  });

  it('sends exactly the location id, the trimmed title and the template, and never twice while creating', async () => {
    const { bridge, creation } = setup();
    bridge.chooseProjectLocation.mockResolvedValueOnce(here);
    await creation.chooseLocation();
    creation.setName('  雾港 新作  ');
    creation.setTemplate('blank');
    let finish!: () => void;
    bridge.createProject.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = creation.create();
    expect(creation.state.busy).toBe('creating');
    expect(creation.canCreate()).toBe(false);
    await creation.create(); // A second submit while the first is running.
    await creation.chooseLocation(); // Changing the folder mid-creation is not offered either.
    expect(bridge.createProject).toHaveBeenCalledTimes(1);
    expect(bridge.chooseProjectLocation).toHaveBeenCalledTimes(1);
    expect(bridge.createProject.mock.calls[0]![0]).toStrictEqual({ locationId: 'loc-1', name: '雾港 新作', template: 'blank' });
    finish();
    await first;
    // The id is spent by a successful creation; another project starts from a new choice.
    expect(creation.state).toMatchObject({ busy: null, location: null, name: '', message: { tone: 'success' } });
    expect(creation.canCreate()).toBe(false);
  });

  it('shows the reason without the native prefix and keeps the location unless the project already exists on disk', async () => {
    const { bridge, creation } = setup();
    bridge.chooseProjectLocation.mockResolvedValueOnce(here);
    await creation.chooseLocation();
    creation.setName('旧作');
    bridge.createProject.mockRejectedValueOnce(nativeError('文件夹「旧作」已存在，请换一个项目名称。'));
    await creation.create();
    expect(creation.state.message).toEqual({ text: '文件夹「旧作」已存在，请换一个项目名称。', tone: 'error' });
    expect(creation.state.location).toEqual(here); // Rename and retry with the same choice.
    creation.setName('旧作二');
    expect(creation.state.message).toBeNull();
    bridge.createProject.mockRejectedValueOnce(nativeError('项目已创建在「D:\\作品\\旧作二」，但暂时无法打开：窗口加载失败'));
    await creation.create();
    expect(creation.state.message?.text).toBe('项目已创建在「D:\\作品\\旧作二」，但暂时无法打开：窗口加载失败');
    // The complete folder stays; repeating the request must not look like it could create it again.
    expect(creation.state.location).toBeNull();
    expect(creation.canCreate()).toBe(false);
  });

  it('reports a failed folder dialog and still allows another try', async () => {
    const { bridge, creation, changed } = setup();
    bridge.chooseProjectLocation.mockRejectedValueOnce(new Error("Error invoking remote method 'editor:choose-project-location': Error: 请选择保存新项目的文件夹。"));
    await creation.chooseLocation();
    expect(creation.state).toMatchObject({ busy: null, location: null, message: { text: '请选择保存新项目的文件夹。', tone: 'error' } });
    expect(changed).toHaveBeenCalled();
    bridge.chooseProjectLocation.mockResolvedValueOnce(here);
    await creation.chooseLocation();
    expect(creation.state).toMatchObject({ location: here, message: null });
  });
});
