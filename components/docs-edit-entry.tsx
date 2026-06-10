import { Button, Modal } from "@heroui/react";

export function DocsEditEntry() {
  return (
    <Modal.Root>
      <Modal.Trigger>
        <Button size="sm" variant="tertiary">
          Edit
        </Button>
      </Modal.Trigger>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>进入编辑模式</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="leading-8 text-muted">
              <p>您即将跳转到编辑模式，将可以编辑/新增页面。</p>
              <p>您的更改不会立刻被刊登，而是需要经过一段时间的审核。</p>
              <p>
                提交更改前您需要填写学号、姓名、邮箱信息（用于通知审核结果），以及QQ/Github账号中的一个（用于获取您的头像，以对您表示鸣谢）。
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="primary"
                onPress={() => {
                  window.location.href = "/edit/docs";
                }}
              >
                我已知晓
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  );
}
