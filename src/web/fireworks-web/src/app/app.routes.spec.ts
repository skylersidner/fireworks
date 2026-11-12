import { routes } from './app.routes';
import { HomePageComponent } from './pages/home/home';

describe('app routes', () => {
  it('lazy-loads the home page at the root path', async () => {
    const home = routes.find((r) => r.path === '');
    expect(home?.component).toBeUndefined();
    expect(await home?.loadComponent?.()).toBe(HomePageComponent);
  });

  it('redirects unknown paths to the root', () => {
    expect(routes.find((r) => r.path === '**')?.redirectTo).toBe('');
  });
});
