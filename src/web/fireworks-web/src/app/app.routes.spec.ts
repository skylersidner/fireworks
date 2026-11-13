import { routes } from './app.routes';
import { DesignerPageComponent } from './features/designer/pages/designer-page/designer-page';
import { StatusPageComponent } from './pages/status/status-page';

describe('app routes', () => {
  it('lazy-loads the designer at the root path', async () => {
    const root = routes.find((r) => r.path === '');
    expect(root?.component).toBeUndefined();
    expect(await root?.loadComponent?.()).toBe(DesignerPageComponent);
  });

  it('lazy-loads the status page at /status', async () => {
    const status = routes.find((r) => r.path === 'status');
    expect(status?.component).toBeUndefined();
    expect(await status?.loadComponent?.()).toBe(StatusPageComponent);
  });

  it('redirects unknown paths to the root', () => {
    expect(routes.find((r) => r.path === '**')?.redirectTo).toBe('');
  });
});
