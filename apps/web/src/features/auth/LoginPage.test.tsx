import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('submits demo credentials and reports authentication errors', async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockRejectedValue(new Error('邮箱或密码错误'));
    render(<LoginPage onLogin={login} />);

    await user.clear(screen.getByLabelText('邮箱'));
    await user.type(screen.getByLabelText('邮箱'), 'author@guide.local');
    await user.clear(screen.getByLabelText('密码'));
    await user.type(screen.getByLabelText('密码'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(login).toHaveBeenCalledWith({ email: 'author@guide.local', password: 'wrong-password' });
    expect(await screen.findByRole('alert')).toHaveTextContent('邮箱或密码错误');
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
  });

  it('offers one-click demo role credentials without logging in automatically', async () => {
    const user = userEvent.setup();
    const login = vi.fn();
    render(<LoginPage onLogin={login} />);

    await user.click(screen.getByRole('button', { name: '使用学习者账号' }));
    expect(screen.getByLabelText('邮箱')).toHaveValue('learner@guide.local');
    expect(screen.getByLabelText('密码')).toHaveValue('Guide123!');
    expect(login).not.toHaveBeenCalled();
  });
});
