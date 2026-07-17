import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VideoNodeView } from './VideoNode';

describe('VideoNodeView', () => {
  it('seeks to a keypoint and notifies the lesson bridge', async () => {
    const user = userEvent.setup();
    let selected = '';
    render(<VideoNodeView data={{
      url: 'https://example.com/demo.mp4',
      caption: 'VA01 演示',
      keypoints: [{ id: 'kp-1', title: '填写售达方', timeSeconds: 15 }],
    }} onKeypoint={(id) => { selected = id; }} />);
    const video = screen.getByLabelText('VA01 演示') as HTMLVideoElement;

    await user.click(screen.getByRole('button', { name: '跳转到 00:15' }));
    expect(video.currentTime).toBe(15);
    expect(selected).toBe('kp-1');
  });

  it('notifies an optional preview bridge when the video is clicked', () => {
    const onOpenPreview = vi.fn();
    render(<VideoNodeView data={{
      url: 'https://example.com/demo.mp4',
      caption: 'VA01 演示',
      keypoints: [],
    }} onOpenPreview={onOpenPreview} />);

    fireEvent.click(screen.getByLabelText('VA01 演示'));
    expect(onOpenPreview).toHaveBeenCalledWith('https://example.com/demo.mp4');
  });
});
