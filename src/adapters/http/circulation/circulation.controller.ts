import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { Loan } from '../../../domain/loan.js';
import { BorrowUseCase } from '../../../application/borrow/borrow.usecase.js';
import { ReturnUseCase } from '../../../application/return/return.usecase.js';
import { requiredString } from './circulation.dto.js';

/**
 * Ce qu'une opération rend au guichet.
 */
interface LoanView {
  /** L'exemplaire concerné. */
  copyId: string;
  /** L'adhérent concerné. */
  memberId: string;
  /** L'échéance du prêt. */
  dueAt: string;
}

/**
 * Rend un prêt lisible par un client HTTP.
 *
 * @param loan - le prêt du domaine
 * @returns sa représentation
 */
function viewOf(loan: Loan): LoanView {
  return {
    copyId: loan.copyId,
    memberId: loan.memberId,
    dueAt: loan.dueAt.toISOString(),
  };
}

/**
 * Les deux opérations du guichet : emprunter et rendre.
 *
 * Une opération métier, une route. Le contrôleur valide, appelle, et traduit ;
 * il ne décide rien. Les refus remontent tels quels et c'est `RefusalFilter`
 * qui leur donne un code, ce qui garde la correspondance en un seul endroit.
 */
@Controller()
export class CirculationController {
  /**
   * @param borrow - le cas d'usage d'emprunt
   * @param give - le cas d'usage de retour
   */
  constructor(
    private readonly borrow: BorrowUseCase,
    private readonly give: ReturnUseCase,
  ) {}

  /**
   * Prête un exemplaire à un adhérent.
   *
   * @param body - l'exemplaire et l'adhérent
   * @returns le prêt créé
   */
  @Post('loans')
  async lend(@Body() body: unknown): Promise<LoanView> {
    const loan = await this.borrow.execute({
      copyId: requiredString(body, 'copyId'),
      memberId: requiredString(body, 'memberId'),
      now: new Date(),
    });
    return viewOf(loan);
  }

  /**
   * Rend un exemplaire.
   *
   * @param body - l'exemplaire rendu
   * @returns la dette constatée et l'adhérent servi le cas échéant
   */
  @Post('returns')
  @HttpCode(200)
  async take(
    @Body() body: unknown,
  ): Promise<{ debt: number; setAsideFor: string | null }> {
    const outcome = await this.give.execute({
      copyId: requiredString(body, 'copyId'),
      now: new Date(),
    });
    return { debt: outcome.debt, setAsideFor: outcome.setAsideFor };
  }
}
