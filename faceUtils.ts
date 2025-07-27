export const mapBoundingBox = (frame: any, width: number, height: number, isFront: boolean) => {
    return {
    left: isFront ? width - (frame.left + frame.width) : frame.left,
    top: frame.top,
    width: frame.width,
    height: frame.height,
    };
  };
  
  export const mapLandmark = (point: any, width: number, isFront: boolean) => {
    if (!point) return null;
    return {
      x: isFront ? width - point.x : point.x,
      y: point.y,
    };
  };
  