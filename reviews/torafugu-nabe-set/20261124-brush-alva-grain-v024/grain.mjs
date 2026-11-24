// Boost repeatable local detail for the tracker. A small neighborhood suppresses
// isolated sensor noise, a wider neighborhood represents the surrounding wood.
export function createGrainFrame(width, height) {
    const stride = width + 1;
    const sums = new Uint32Array(stride * (height + 1));
    const result = new ImageData(width, height);
    const smallRadius = 1, largeRadius = 7;
    return function trackingFrame(image) {
        const input = image.data, output = result.data;
        output.set(input);
        for (let y = 0; y < height; y++) {
            let row = 0;
            const above = y * stride, current = above + stride;
            for (let x = 0, pixel = 4 * y * width; x < width; x++, pixel += 4) {
                row += (input[pixel] + 2 * input[pixel + 1] + input[pixel + 2]) >> 2;
                sums[current + x + 1] = sums[above + x + 1] + row;
            }
        }
        for (let y = largeRadius; y < height - largeRadius; y++) {
            const s0 = (y - smallRadius) * stride, s1 = (y + smallRadius + 1) * stride;
            const l0 = (y - largeRadius) * stride, l1 = (y + largeRadius + 1) * stride;
            for (let x = largeRadius; x < width - largeRadius; x++) {
                const near = (sums[s1+x+2] - sums[s0+x+2] - sums[s1+x-1] + sums[s0+x-1]) / 9;
                const far = (sums[l1+x+8] - sums[l0+x+8] - sums[l1+x-7] + sums[l0+x-7]) / 225;
                const detail = near - far, amount = Math.abs(detail);
                if (amount <= 2 || amount >= 36) continue;
                const boost = Math.sign(detail) * Math.min((amount - 2) * 3, 24, (36 - amount) * 2);
                const i = 4 * (y * width + x);
                output[i] += boost;
                output[i + 1] += boost;
                output[i + 2] += boost;
            }
        }
        return result;
    };
}
